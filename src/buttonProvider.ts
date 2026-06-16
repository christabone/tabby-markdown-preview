import { Injectable } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton, AppService } from 'tabby-core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { CwdResolver } from './cwdResolver'
import { FileBrowserComponent } from './fileBrowser.component'
import { MarkdownPreviewTabComponent } from './previewTab.component'
import { markdownIcon } from './icon'

@Injectable()
export class MarkdownToolbarButtonProvider extends ToolbarButtonProvider {
  constructor(
    private app: AppService,
    private ngbModal: NgbModal,
    private cwdResolver: CwdResolver,
  ) {
    super()
  }

  provide(): ToolbarButton[] {
    return [{
      icon: markdownIcon,
      title: 'Preview markdown file',
      weight: 5,
      click: () => this.openBrowser(),
    }]
  }

  private async openBrowser(): Promise<void> {
    const { dir, notice } = await this.cwdResolver.resolve()
    const modal = this.ngbModal.open(FileBrowserComponent, { size: 'lg' })
    modal.componentInstance.init(dir, notice)

    let filePath: string | undefined
    try {
      filePath = await modal.result
    } catch {
      return // dismissed / escaped
    }
    if (filePath) {
      this.app.openNewTab({ type: MarkdownPreviewTabComponent, inputs: { filePath } })
    }
  }
}
