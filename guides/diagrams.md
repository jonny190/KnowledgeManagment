# Diagrams

This guide covers how to create and edit diagrams in your vault. Two kinds of diagram are supported: drawio flow diagrams for general boxes and arrows, and BPMN diagrams for business process modelling.

## Creating a drawio diagram

Open any folder in your vault sidebar. Right-click the folder name and choose "new-drawio" from the prompt. A name prompt appears; type a title and press Enter. The platform creates the diagram and opens the editor immediately.

The drawio editor opens inside the page. Use the palette on the left to drag shapes onto the canvas, connect them with arrows, and double-click shapes to add labels. Your changes save automatically a moment after you stop editing, so you do not need to press a Save button.

## Creating a BPMN diagram

From the same folder context menu, choose "new-bpmn". After typing a title, the BPMN editor opens with an empty process canvas.

Drag a start event from the palette on the left side of the canvas. Add tasks by selecting the task shape and clicking on the canvas. Connect elements by hovering over a shape until the connection handles appear, then dragging to the next shape.

When you are ready to save, press the Save button at the top of the page. The platform sends the current diagram to the server and confirms when it has been stored. If another browser session saved the same diagram between when you opened it and when you pressed Save, the server will return a conflict warning. Reload the page to get the latest version and make your changes again.

## Linking a diagram from a note

Inside any note you can link to a diagram the same way you link to another note. Type two opening square brackets and start typing the diagram title. The autocomplete list will suggest matching diagrams alongside notes. Select the diagram title and press Enter to insert the link.

When you hold Ctrl or Cmd and click that link in the editor, the platform looks up the title and navigates to the diagram page if a match is found. If both a note and a diagram share the same title, the link goes to the note. To avoid ambiguity, use distinct titles when a note and a diagram cover the same subject.

## Exporting diagrams

When you export your vault through the settings panel, all diagrams are included in the zip archive alongside your markdown notes. Drawio diagrams are saved as `.drawio` files and BPMN diagrams as `.bpmn` files. The folder structure inside the archive mirrors your vault structure, so a diagram in a folder called Projects appears at `Projects/my-diagram.drawio` in the export.

You can open `.drawio` files in the standalone drawio desktop app or at app.diagrams.net. BPMN files can be opened in any BPMN-compatible tool such as Camunda Modeler.
