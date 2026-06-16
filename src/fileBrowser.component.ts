import { ChangeDetectorRef, Component } from '@angular/core'
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

  constructor(public activeModal: NgbActiveModal, private cdr: ChangeDetectorRef) {}

  /** Called by the opener right after the modal is created, with the resolved directory.
   * Done explicitly (not in ngOnInit) because NgbModal runs ngOnInit before the caller
   * can assign inputs, which would otherwise navigate to an empty directory. */
  init(dir: string, notice?: string): void {
    this.dir = dir
    this.notice = notice
    void this.navigate(dir)
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
    // fs.promises continuations run outside Angular's zone, so refresh the view manually.
    this.cdr.detectChanges()
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
