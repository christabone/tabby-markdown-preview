import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import * as path from 'path'
import { listDirectory, DirEntry } from './directoryListing'

@Component({
  selector: 'markdown-file-browser',
  template: require('./fileBrowser.component.pug'),
  styles: [require('./fileBrowser.component.scss')],
})
export class FileBrowserComponent {
  dir = ''
  notice?: string
  entries: DirEntry[] = []
  error: string | null = null

  constructor(public activeModal: NgbActiveModal) {}

  async ngOnInit(): Promise<void> {
    await this.navigate(this.dir)
  }

  canGoUp(): boolean {
    return !!this.dir && path.dirname(this.dir) !== this.dir
  }

  up(): void {
    void this.navigate(path.dirname(this.dir))
  }

  async navigate(target: string): Promise<void> {
    try {
      this.entries = await listDirectory(target)
      this.dir = target
      this.error = null
    } catch (e: any) {
      this.error = `Cannot open ${target}: ${e?.message ?? e}`
      this.entries = []
    }
  }

  open(entry: DirEntry): void {
    if (!entry.clickable) {
      return
    }
    if (entry.isDirectory) {
      void this.navigate(entry.path)
    } else {
      this.activeModal.close(entry.path)
    }
  }
}
