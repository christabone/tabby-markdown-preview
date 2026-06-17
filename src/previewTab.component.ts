import { ChangeDetectorRef, Component, ElementRef, Injector, ViewChild } from '@angular/core'
import { BaseTabComponent } from 'tabby-core'
import { shell } from 'electron'
import { PreviewError } from './fileReader'
import { renderMarkdown } from './markdownRenderer'
import { buildPreviewDocument } from './previewDocument'
import markdownCss from './markdown-dark.scss'

@Component({
  selector: 'markdown-preview-tab',
  template: require('./previewTab.component.pug'),
  styles: [require('./previewTab.component.scss')],
})
export class MarkdownPreviewTabComponent extends BaseTabComponent {
  title = ''
  loader: () => Promise<string> = async () => ''
  baseDir: string | null = null
  error: string | null = null
  @ViewChild('frame', { static: false }) frame!: ElementRef<HTMLIFrameElement>

  constructor(private cdr: ChangeDetectorRef, injector: Injector) {
    // Tabby's runtime BaseTabComponent requires an Injector (it calls injector.get(ConfigService)),
    // but the published tabby-core typings declare a parameterless constructor — hence the ts-ignore.
    // @ts-ignore
    super(injector)
  }

  async ngOnInit(): Promise<void> {
    this.setTitle(this.title)
  }

  async ngAfterViewInit(): Promise<void> {
    await this.load()
  }

  async load(): Promise<void> {
    this.error = null
    try {
      const md = await this.loader()
      const body = renderMarkdown(md, { baseDir: this.baseDir })
      const doc = buildPreviewDocument(body, markdownCss)
      this.frame.nativeElement.srcdoc = doc
    } catch (e: any) {
      this.error = e instanceof PreviewError ? e.message : `Could not read file: ${e?.message ?? e}`
    }
    // loader (fs/SFTP) continuations run outside Angular's zone — refresh the view.
    this.cdr.detectChanges()
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
