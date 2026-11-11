# Signal-Sketch User Guide

An app for drawing audio, video, control and network system diagrams. Place devices and connect ports with the mouse: lines are routed automatically and colored by signal type.

## 1. Starting

- Double-click `index.html` (a single file) to open it in a browser.
- No installation, web server or network connection is needed.
- **Edge or Chrome is recommended**, because they provide a save dialog. In Firefox and Safari, saving becomes a download (not verified).
- Diagram data stays on your computer. Nothing is sent elsewhere.
- It starts with an empty diagram. A sample diagram, [docs/sample_diagram.json](sample_diagram.json), can be loaded with "Open" (all device names and model numbers in it are fictitious).

## 2. Screen

| Area | Contents |
|---|---|
| Top | Toolbar (New, Open, Save, exports, Import device list, Issues, Undo, Redo, Delete, Snap to grid, zoom, language switch, theme switch) |
| Left | Palette (frames, standard devices, devices in this diagram) |
| Center | The diagram (1280x720, 16:9 at first; the size can be changed), with the legend below |
| Right | Properties (settings of the selection; with nothing selected, the issues list and the legend editor) |

On first launch, the language follows your browser's preferred (first) language: Japanese if it is Japanese, English otherwise. Switch it with the "English / 日本語" button; your choice is remembered and takes priority from then on. Only the UI text changes; device names and model numbers you typed stay as they are.

The "Theme" button cycles through Auto (follows your OS light/dark setting), Light and Dark. Your choice is remembered, except for Auto. SVG and PNG use the current theme and its background. In Dark, signal colors that are hard to see are lightened on screen and in exports; saved signal colors remain unchanged.

### Zooming the view

- Use "Zoom out" / "Zoom in" in the toolbar (25% to 300%), "100%" (back to actual size) and "Fit" (shrinks the diagram to fit the window; it never enlarges).
- **Ctrl+wheel** zooms around the mouse pointer (a trackpad pinch works too). The plain wheel scrolls. **Dragging with the middle button** also moves the view.
- Zoom only changes the display. The diagram data, the saved file, and the SVG/PNG/CSV exports are unaffected.

### Page size

If the devices do not fit, you can enlarge the page (the drawing area). With nothing selected, use "Page size" in the right panel.

- **Standard**: 1280x720 / 1920x1080 / 2560x1440 (all 16:9, the same ratio as a PowerPoint slide).
- **Custom**: choose "Custom" to type a width and height (width 640-4000, height 360-4000; rounded to the grid). Ratios other than 16:9 are allowed.
- A larger page makes the text relatively smaller once pasted onto a slide.
- You can only shrink the page as far as all devices and frames still fit. If something would stick out, the size stays and its name is shown at the top right.
- Changes can be undone. The size is saved, and the SVG/PNG exports use it.

## 3. Placing devices

- **Click** a palette item to add it at a free spot, or **drag** it to place it where you want.
- Standard devices: generic device, PC, touch panel, camera, microphone, speaker, amplifier, display, encoder, decoder, and switch (8 ports). You can change the number of ports of a switch in the right panel after placing it (24 ports, 48 ports and so on).
- Drag a device to move it. Positions and sizes snap to a **10 px grid** (toggle with "Snap to grid" in the toolbar).
- Select a device to edit its **name, model and quantity** in the right panel. A value is committed when you leave the field or press Tab.

### Place several devices at once (in a row)

- **Hold Shift while dropping** a device from the palette to open "Add in a row". Choose the **count** (1–99), the **direction** (side by side / stacked) and the **gap** (px), then press "Add". Devices with the same name are placed in a row, starting at the drop position.
- The gap is a minimum. With grid snapping on, the step is rounded up to a multiple of the grid so every device lands on the grid.
- If you drop where the row would run past the page edge, it is shifted inward. If the row cannot fit on the page at all, nothing is added and the reason appears at the top right.
- All added devices are selected, and one Undo removes them together. The last count, direction and gap are the defaults the next time. Frames are not affected.

### Select several devices and delete them together

- **Drag on an empty spot** to draw a box. Devices, frames and lines that fit **completely inside** the box are selected (merely touching is not enough). You cannot start from an empty spot inside a frame (that would move the frame); draw the box from outside it.
- **Ctrl (Cmd on Mac) or Shift + click** adds to or removes from the selection. **Ctrl+A** selects everything.
- With two or more selected, the right panel shows the count. **Delete** (or the Delete button) removes them together, and one Undo brings them back. Copy and duplicate (next section) also work on everything selected.
- With two or more devices selected, **Change together** in the panel sets the **name, model, quantity, width and height** of all of them at once. A field shows the shared value when all selected devices agree, and is blank (with a faint "Mixed values") when they differ. **Only the fields you edit** are applied; the rest stay as they are. It also works on a mix of device types. One Undo reverts all of them. Clearing the quantity field means "leave unchanged" (to remove the quantity mark, select the devices one by one).
- When the selected devices have **exactly the same port layout**, the Ports section also applies to all of them at once (signal, direction, side, count, connections, prefix, adding and removing groups). If you mix devices with different layouts, they cannot be changed together, so select devices with the same layout. If some lines would be removed, you are asked to confirm first.
- With two or more devices selected, the right panel shows **Align / distribute** buttons. **Align left, Center horizontally, Align right, Align top, Center vertically, Align bottom** line the devices up with the rectangle that surrounds the whole selection. **Space evenly (horizontal / vertical)** needs three or more devices: the two outermost devices stay put and the gaps between devices are made equal. When grid snap is on, the resulting positions are rounded to the grid (centering and even spacing can be off by up to half a grid step). Frames are not moved. One Undo reverts the change.
- Shift + drag on an empty spot selects **ports** instead of devices (see "Connect many ports at once").

### Right-click menu

Right-click on the diagram to open a menu with the actions available at that spot (the same actions as the shortcuts and the panel buttons).

- **On a device, frame or line**: Copy, Duplicate, Delete. With two or more devices selected, Align and Space evenly are also shown (Space evenly needs three or more devices). Right-clicking something that is not selected selects just that item first; right-clicking something that is already selected (even among several) keeps the selection.
- **On an empty spot**: Paste (when something has been copied) and Select all.
- Close it with Esc, by clicking outside, or by scrolling or resizing the window. From the keyboard, use Up/Down/Home/End to choose an item and Enter to run it.
- Over the panel, the toolbar and dialogs, the browser's own menu is left as it is.

### Copy and duplicate

- Select devices or frames, then press **Ctrl+C** to copy and **Ctrl+V** to paste. **Ctrl+D** duplicates in place.
- Name, model, quantity, port setup and port positions carry over. Connections between the copied devices are copied too (connections to devices outside the selection are not).
- Devices are pasted a little to the lower right each time. A frame is copied with the devices inside it, and pasted where it overlaps other devices and frames as little as possible.
- Ctrl+drag is an ordinary move, not a copy. Copying works only within the same window (you cannot paste into another window).

### Device size and images

- With a single device selected, **drag its corner or edge handles to resize it** (when you drag a left or top handle, the right and bottom edges stay put). For a device with an image, **hold Shift while dragging to fit the size to the image's aspect ratio** (no margins, except for a little left over by grid rounding when grid snap is on). Without Shift you can resize freely; the image is never distorted and the extra space becomes margins. With several devices selected they cannot be resized.
- Select a device and the panel also shows **Width** and **Height** (for when you want to type a value). Values are rounded to the grid (when grid snap is on) and cannot go below the size the ports and text need. A device cannot be larger than the page (except a device whose minimum size, set by its ports and text, already exceeds the page). Connections are kept; only the port positions change.
- **Choose image…** sets your own image on a device (PNG, JPEG or WebP, up to 5 MB and 40 million pixels for the original file). It is shown **keeping its aspect ratio** in the area below the name line. Right after you set it, the device keeps its width and its height grows to fit the image. You can change the width and height afterwards. **Remove image** brings back the small icon.
- On import the image is shrunk to at most 640 px on its longest side and stored inside the diagram file (the original is not kept; handing over the diagram file hands over the images too). Images that are no longer used are dropped when you save. One diagram can hold up to 50 images, 5 MB in total.
- A JPEG cannot be transparent, so its white background stays. **For dark mode, a PNG with a transparent background works best.** SVG images are not supported.
- **You can also set an image while several devices are selected** (the "Image" section in the right panel). The same image goes on every selected device (different types are fine and an existing image is replaced; frames are not affected), and each device keeps its width while its height grows to fit the image. "Remove image" also applies to every selected device. One Undo reverts it.
- Copying or duplicating a device shares the same image. SVG and PNG exports include the images.
- Rights to the images (copyright, trademarks and so on) are your responsibility.

### Register a device in "In this diagram"

- Select one device and press **Register this device…** in the Image section of the right panel. Enter a registration name (1–100 characters after trimming leading and trailing spaces). The device's **effective port setup, image and size** are added to "In this diagram" in the palette. Its model, quantity and position are not registered.
- If that registration name already exists, a number such as `(2)` or `(3)` is appended. You can place the registered device just like a standard device: click, drag, or Shift+drop to add a row. Its registered image and size are carried over.
- A registration belongs to that diagram file only. One diagram can hold up to 200 device types in total, including standard types already used in the diagram.
- Press the small **×** on a palette item to delete its registration. A registration cannot be deleted while any placed device still uses it; the reason appears at the top right. Delete those devices first. Deleting a registration can be undone.

### Devices with a quantity of two or more

With a quantity of 2 or more, **ports are shown for every unit**, so each unit can be connected to a different destination. Tooltips show which unit, such as "LAN (Unit 3)". If lowering the quantity would remove connected ports, you are asked to confirm.

The quantity can be **1 to 999**, and a device can have at most **5000 visible ports in total** (counting every unit). The nominal number per unit, including skipped ports, is limited to 50,000. Larger values are refused to keep the screen responsive. A diagram file that exceeds these limits cannot be opened.

## 4. Port settings

Select a device and the "Ports" section lists its port **groups**. Each group has these settings.

| Item | Meaning |
|---|---|
| Signal | The signal type. It decides the color of lines and ports |
| Direction | Input / Output / Input-output, shown by the marker shape (input = inward triangle, output = outward triangle, input-output = diamond) |
| Position | Which side of the device the ports are on: left, right, top or bottom |
| Count | Number of ports |
| Connections | "One" or "Multiple" (normally one) |
| Display name | The port's name. A group with a single port has no number ("LAN"); two or more are numbered ("LAN 1") |
| Starting number | First displayed number, from 0 to 9999 |

- "Add port" adds a group. Changes apply to that device only; other devices of the same kind are unchanged.
- Right-click a port to remove it. To remove several on one device, select ports with Shift-drag and right-click one of them. Connected lines are counted in a confirmation. Numbers of the remaining ports do not change. Undo restores the removal, including its connections. For multiple units the same number is removed from every unit.
- A port marker is hollow when free and filled with the signal color when connected. **Hover** over a port to see its name.
- **Move a single port**: hold Shift and drag the port. It is placed on the nearest side at a grid position. It cannot be placed where another port already is. "Reset port positions to automatic" in the panel undoes this.

## 5. Connecting

- Drag from one port to another. The line is routed automatically at right angles.
- **Only one line can attach to a port** (except ports set to "Multiple").
- While dragging, the **candidate destinations** (free ports with the same signal type) get a blue ring and the other ports are dimmed. If you start from a port that is already connected, there are no candidates, so every port is dimmed. You can still connect to other signal types or input to input (with a warning).
- Hovering over a port shows a soft ring in the signal color around it.
- You cannot connect a port to itself, or repeat an existing connection. The reason is shown at the top right for a few seconds.
- Select a line and use "Delete" (or the Delete key) to remove it. Deleting a device also removes its lines.
- Lines are routed automatically when you connect them. Select a line and drag its **handle** (in the middle of a segment) to **reroute it by hand**. The route you draw is remembered: it stays after you save and reopen the file and after other operations redraw the diagram (and Undo reverts it). When both end devices move together (a whole frame, or a multi-selection), the route moves with them. If **only one end** moves, or the size or ports change so that an end's position changes, the old route no longer fits, so that line goes back to automatic routing (reroute it again).
- A line's color follows the signal type of its output-side port.

### Connecting many ports at once

Connect devices with several units, or devices with a row of identical ports (such as a switch), in a single operation.

1. **Hold Shift and drag** from an empty spot (inside a frame is fine too) to draw a box. Ports the box touches are selected (orange rings), even across devices.
2. **Drag any one of the selected ports** and drop it on the port you want to connect to.
3. The selected ports are connected **one-to-one, in order** (top to bottom, left to right), starting at the port you dropped on. The destinations are the free ports of the same port group on the same device, from the drop target onward.
4. While dragging, pairs to be connected are shown as dashed lines, and ports that cannot be connected get a red ring with a cross. The message at the top right shows how many will be connected.
5. On drop, they are connected together. **One Undo (Ctrl+Z)** reverts them all.

**If the device you drop on is inside a frame (group), the connection also continues into other devices in the same frame.** Once the ports of the drop target are used up, it moves on to free ports of the same port group (same signal and direction) on devices that come later in the same frame, in reading order (top to bottom; devices whose vertical position differs by no more than half a device height count as the same row, then left to right). For example, select several amplifier outputs and drop them on the first of the speakers placed in a frame, and each speaker gets one in turn. Devices without a matching port are skipped; devices outside the frame, or earlier than the drop target, are never used. While dragging, the destination frame is outlined with a dashed line. A device that is not in a frame behaves as before: only that one device is used.

Not connected: ports that are already connected, selected ports left over when the destination runs out of free ports, pairs with different signal types, and input-to-input / output-to-output pairs. If the selection mixes inputs and outputs, nothing is connected. Connecting one by one still allows different signal types and input-to-input / output-to-output pairs (with a warning); a port that already has a connection stays refused. Press Esc (or click an empty spot) to clear the selection; press Esc while dragging to cancel the drag.

## 6. Issues

These connections are allowed, but reported as "Issues".

- Ports with different signal types (the line is **dotted**).
- Input to input, or output to output (the line is **dashed**). Input-output ports pair with either.

The toolbar shows the count as "Issues N". Click it to show the list (device and port names, with the reason) in the right panel. Click an item to select the line. Fixing the cause removes the item automatically.

Dashes and dots are working aids. SVG/PNG exports draw them as solid lines.

## 7. Frames (groups)

- Add one from "Frame (group)" in the palette. Click the frame outline to select it.
- **Drag** a frame and **the devices inside move with it**. Use the **handles** on corners and edges to resize it (devices inside do not move).
- Edit the frame's name in the panel.
- **Membership follows what you see**: a device belongs to a frame when its center is inside it. Move it in to join, out to leave; there is no join/leave operation. With nested frames, the inner frame is the one it belongs to.
- Deleting a frame keeps the devices inside it.

### Notes (text only)

You can put text-only notes on the diagram (no frame, no background).

- Under "Frames" on the left, click **Note (text only)** to add one, or drag it to where you want it. A new note contains the word "Note"; rewrite it in the **Text** field of the right panel (multiple lines, up to 1,000 characters).
- In the panel you can change the **text color** (any color; "Match theme" restores the default), the **text size** (8-48; blank for the default), and the width and height. Choosing a color fixes it, so it does not change when you switch between light and dark.
- Notes move by dragging, like devices, and the handles change the width at which the text wraps. Arrow keys, copy / paste / duplicate, the right-click menu, Delete and Undo all work. With two or more notes selected, color and text size can be changed together.
- A note inside a frame (its center is inside the frame) moves with the frame and is copied with it.
- Notes are included in the SVG and PNG exports (as real text in SVG). A page holds up to 100 notes. Notes cannot be connected with lines and are not part of the issues list.

## 8. Editing the legend (signal types)

With nothing selected, the right panel edits the signal types.

- You can rename, recolor, reorder, add and delete types. A color change updates lines, ports and the legend at once.
- You can choose a **line style** (solid, dashed, dotted) for each signal. It helps people who find colors hard to tell apart, and black-and-white printing (for example, solid for LAN and dashed for the rest). The legend swatch and the SVG / PNG exports show the same style. Lines **with an issue** (direction or signal mismatch) are still shown dashed or dotted as before, whatever the signal's style.
- A type in use cannot be deleted (whether ports use it or a device type definition refers to it).
- Renaming keeps the internal ID, so connections are not broken.
- The defaults are five types: LAN, CONTROL, HDMI, USB and AUDIO.

## 9. Saving, opening and exporting

| Action | Result |
|---|---|
| Save / Open | Save and load the diagram as a JSON file. Ctrl+S also saves. Device images are stored inside the diagram file (handing over the file hands over the images too) |
| Export SVG | Text is written as real text, so it can be pasted into PowerPoint and similar. Includes the legend. Device images are included (see the note below) |
| Export PNG | A double-resolution image. Includes the legend. Device images are included |
| Device list (CSV) | Name, model, quantity, type, ports, location (the name of the frame it belongs to). Identical devices are merged into one row and quantities are summed. Opens in Excel |

If there are unsaved changes, "New" and "Open" ask for confirmation.

**Note for pasting into PowerPoint (diagrams with images):** the SVG export embeds device images inside the SVG as images. Whether PowerPoint shows them can depend on its version, and **this has not been verified yet**. If they do not appear, use the **PNG export** instead (it always pastes; the text is no longer editable). Devices without an image are exported as shapes as before, so their SVG works as is.

### Importing a device list (CSV)

Create a first draft of a diagram (devices and frames) from a quote or an equipment list (Excel and the like). Choose a CSV with "Import device list" in the toolbar. **Connections are not created** (draw them on the diagram). The devices are **added** to the current diagram (nothing is replaced). A confirmation appears first, and **one Undo** reverts the whole import.

**How to make the CSV**: first export one with "Device list (CSV)", keep its first row (the header) as it is, and edit or add rows. A sample is [docs/sample_devices.csv](sample_devices.csv).

| Header (Japanese / English) | Meaning |
|---|---|
| 名称 / Name (**required**) | The device name |
| 型番 / Model | The model |
| 台数 / Quantity | An integer from 1 to 999 (1 if empty). It becomes the **quantity of one device** (one set of ports per unit) |
| 種類 / Type | The name of a standard device (below). A generic device if empty |
| ポート数 / Ports | An integer (may be empty). On rows whose type is "Switch", it is **used as the number of LAN ports** (empty or 0 means 8; at most 5000 ports per device, counting every unit). For other types it is not used on import (the port layout comes from the standard device of that type) |
| 場所 / Location | Devices with the same location are grouped into a frame of that name. Empty means no frame |

- **Only headers identical to the names above (Japanese or English) are accepted** (leading and trailing spaces are ignored). Other names such as "Device", "Machine" or "name" are not accepted. The column order is free.
- **Columns with an unknown header** (such as notes) are not imported, and the confirmation shows "Column not imported" (so a misspelled header is noticed).
- **A type matches only when it is identical to the name of a standard device** (full-width/half-width and upper/lower case all count; only spaces at the start and end of a cell are ignored). Japanese: 汎用機器 / PC / タッチパネル / カメラ / マイク / スピーカ / アンプ / ディスプレイ / エンコーダ / デコーダ / スイッチ. English: Generic device / PC / Touch panel / Camera / Microphone / Speaker / Amplifier / Display / Encoder / Decoder / Switch. A type that does not match (including the name of a device that exists only in this diagram) becomes a **generic device**, and the confirmation lists it.
- Importing an exported CSV keeps name, model, quantity, type and location, but **the port layout returns to the standard one**, and identical devices that were placed separately are merged into one device (with a quantity).
- **Layout**: one frame per location, with devices laid out left to right and wrapped inside it. Placement starts below the existing devices and frames, and **anything that does not fit on the page is not placed** (the page is never enlarged; devices that could not be placed are listed in the confirmation). If nothing can be placed, you are told to enlarge the page.
- **Errors** (nothing is added): no "Name" column in the first row or the same column twice, a row with an empty name, a quantity or port count that cannot be used, an unclosed quotation mark. They are shown with row numbers.
- **Character encoding**: UTF-8 (including with a BOM) and Shift_JIS are detected automatically. A file saved from Excel as "CSV (comma delimited)" can be imported as it is. A warning appears if the text may be garbled.
- On export, values that start with `=`, `+`, `-` or `@` get a `'` in front (so spreadsheet software does not run them as formulas). Import removes that `'` to restore the original value.

## 10. Keyboard

| Key | Action |
|---|---|
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Ctrl+C / Ctrl+V | Copy / paste the selected devices and frames |
| Ctrl+D | Duplicate the selected devices and frames in place |
| Ctrl+S | Save |
| Drag (empty spot) | Select the devices, frames and lines inside the box |
| Ctrl+click / Shift+click | Add to / remove from the selection |
| Shift+drop (device from the palette) | Choose count, direction and gap, and add them in a row |
| Ctrl+wheel | Zoom around the mouse pointer |
| Ctrl+`+` / Ctrl+`-` / Ctrl+0 | Zoom in / zoom out / back to 100% |
| Ctrl+A | Select everything (devices, frames, lines) |
| Arrow keys | Move the selected devices, frames and notes by one grid step |
| Delete / Backspace | Delete the selected devices, lines and frames |
| Right-click | Menu (copy, duplicate, delete, paste, select all; with two or more devices selected, also align and space evenly) |
| Drag (a device handle, with a single device selected) | Resize it |
| Shift+drag (a device handle) | Resize a device with an image to fit the image's aspect ratio |
| Shift+drag (a port) | Move the port's position |
| Shift+drag (an empty spot) | Select the ports inside the box (then drag them to connect at once) |
| Esc | Clear the port selection / cancel while dragging |
| Tab | Next field in the panel (commits the value and moves on) |

## 11. Known limitations

- A diagram is a single page. Multiple pages are not supported.
- SVG images, cropping and rotating are not supported. An image can be up to 5 MB and 40 million pixels as a file, and is shrunk to at most 640 px on its longest side when added (enlarging it makes it blurry). One diagram can hold up to 50 images, 5 MB in total.
- Devices registered under "Devices in this diagram" cannot be renamed or edited (delete and register again). Registrations are usable only inside that diagram file.
- You cannot adjust line routes by hand.
- There are size limits (they keep the screen from freezing). Per device: a quantity of 1 to 999 and at most 5000 ports in total. Per page: 2000 devices, 20000 ports in total and 20000 connections. A diagram file can be up to 20 MB, and a device-list CSV up to 5 MB (10000 data rows). Files over a limit cannot be opened.
- While dragging a frame, the devices inside do not follow; they all move when you drop it.
- Firefox and Safari have not been checked.
- There is no direct .pptx export. Paste the SVG export instead.
