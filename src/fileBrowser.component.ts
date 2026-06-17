import { ChangeDetectorRef, Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { DirEntry } from './directoryListing'
import { FileSource } from './fileSource'

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
  private source!: FileSource

  constructor(public activeModal: NgbActiveModal, private cdr: ChangeDetectorRef) {}

  /** Called by the opener right after the modal is created (NgbModal runs ngOnInit
   * before inputs are assigned, so we navigate explicitly here). */
  init(source: FileSource): void {
    this.source = source
    this.notice = source.notice
    void this.navigate(source.start)
  }

  canGoUp(): boolean {
    return !!this.dir && this.source.parentOf(this.dir) !== this.dir
  }

  up(): void {
    void this.navigate(this.source.parentOf(this.dir))
  }

  async navigate(target: string): Promise<void> {
    try {
      this.entries = await this.source.list(target)
      this.dir = target
      this.error = null
    } catch (e: any) {
      this.error = `Cannot open ${target}: ${e?.message ?? e}`
      this.entries = []
    }
    // fs/SFTP continuations run outside Angular's zone, so refresh the view manually.
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
