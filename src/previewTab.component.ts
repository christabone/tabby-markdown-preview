import { Component, ElementRef, ViewChild } from '@angular/core'
import { BaseTabComponent } from 'tabby-core'
import { shell } from 'electron'
import * as path from 'path'
import { readMarkdownFile, PreviewError } from './fileReader'
import { renderMarkdown } from './markdownRenderer'
import { buildPreviewDocument } from './previewDocument'
import markdownCss from './markdown-dark.scss'

@Component({
  selector: 'markdown-preview-tab',
  template: require('./previewTab.component.pug'),
  styles: [require('./previewTab.component.scss')],
})
export class MarkdownPreviewTabComponent extends BaseTabComponent {
  filePath = ''
  error: string | null = null
  @ViewChild('frame', { static: false }) frame!: ElementRef<HTMLIFrameElement>

  constructor() {
    super()
  }

  async ngOnInit(): Promise<void> {
    this.setTitle(path.basename(this.filePath))
  }

  async ngAfterViewInit(): Promise<void> {
    await this.load()
  }

  async load(): Promise<void> {
    this.error = null
    try {
      const md = await readMarkdownFile(this.filePath)
      const body = renderMarkdown(md, { baseDir: path.dirname(this.filePath) })
      const doc = buildPreviewDocument(body, markdownCss)
      this.frame.nativeElement.srcdoc = doc
    } catch (e: any) {
      this.error = e instanceof PreviewError ? e.message : `Could not read file: ${e?.message ?? e}`
    }
  }

  onFrameLoad(): void {
    const doc = this.frame?.nativeElement?.contentDocument
    if (!doc) {
      return
    }
    doc.addEventListener('click', (ev: MouseEvent) => {
      const anchor = (ev.target as HTMLElement)?.closest?.('a')
      if (!anchor) {
        return
      }
      ev.preventDefault()
      const href = anchor.getAttribute('href') || ''
      if (/^(https?:|mailto:)/i.test(href)) {
        shell.openExternal(href).catch(err => console.error('openExternal failed:', err))
      }
    })
  }
}
