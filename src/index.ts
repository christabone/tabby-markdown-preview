import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ToolbarButtonProvider } from 'tabby-core'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import { MarkdownToolbarButtonProvider } from './buttonProvider'
import { FileBrowserComponent } from './fileBrowser.component'
import { MarkdownPreviewTabComponent } from './previewTab.component'

@NgModule({
  imports: [CommonModule, NgbModule],
  providers: [
    { provide: ToolbarButtonProvider, useClass: MarkdownToolbarButtonProvider, multi: true },
  ],
  declarations: [FileBrowserComponent, MarkdownPreviewTabComponent],
})
export default class MarkdownPreviewModule {}
