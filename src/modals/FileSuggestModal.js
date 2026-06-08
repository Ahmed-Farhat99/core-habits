import { FuzzySuggestModal } from 'obsidian';

class FileSuggestModal extends FuzzySuggestModal {
  constructor(app, onSelect) {
    super(app);
    this.onSelect = onSelect;
  }

  getItems() {
    // Return all markdown files in the vault
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file) {
    // Display the file path in the suggester
    return file.path;
  }

  onChooseItem(file, evt) {
    //Call the callback with the selected file
    this.onSelect(file);
  }
}

export { FileSuggestModal };