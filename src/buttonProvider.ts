import { Injectable } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton, AppService } from 'tabby-core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { SourceResolver } from './sourceResolver'
import { FileBrowserComponent } from './fileBrowser.component'
import { MarkdownPreviewTabComponent } from './previewTab.component'
import { markdownIcon } from './icon'

@Injectable()
export class MarkdownToolbarButtonProvider extends ToolbarButtonProvider {
  constructor(
    private app: AppService,
    private ngbModal: NgbModal,
    private sourceResolver: SourceResolver,
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
    const source = await this.sourceResolver.resolve()
    const modal = this.ngbModal.open(FileBrowserComponent, { size: 'lg' })
    modal.componentInstance.init(source)

    let filePath: string | undefined
    try {
      filePath = await modal.result
    } catch {
      return // dismissed / escaped
    }
    if (filePath) {
      this.app.openNewTab({
        type: MarkdownPreviewTabComponent,
        inputs: {
          title: source.parentOf(filePath) === filePath ? filePath : filePath.split(/[\\/]/).pop() || filePath,
          loader: () => source.read(filePath as string),
          baseDir: source.allowImages ? sourceDirname(source, filePath) : null,
        },
      })
    }
  }
}

function sourceDirname(source: { parentOf(p: string): string }, filePath: string): string {
  return source.parentOf(filePath)
}
