import { FuzzySuggestModal } from 'obsidian';

class FileSuggestModal extends FuzzySuggestModal {
  constructor(app, onSelect) {
    super(app);
    this.onSelect = onSelect;
  }

  getItems() {
    // Return all markdown files in the vault
    // LEGITIMATE USE: Vault scanning is required to list all markdown files for the file suggest modal, letting users select a specific note path.
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file) {
    // Display the file path in the suggester
    return file.path;
  }

  onChooseItem(file) {
    //Call the callback with the selected file
    this.onSelect(file);
  }
}

export { FileSuggestModal };