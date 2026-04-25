export class VoiceRecorderUtility {
  static isRecording = false;
  static mediaRecorder = null;
  static stream = null;
  static chunks = [];

  static async startRecording() {
    if (this.isRecording) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm' });
      this.chunks = [];
      this.mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      this.mediaRecorder.start();
      this.isRecording = true;
      return true;
    } catch (e) {
      console.error("[Core Habits] Failed to start voice recording:", e);
      return false;
    }
  }

  static async stopAndSaveRecording(app) {
    if (!this.isRecording || !this.mediaRecorder) return null;
    
    return new Promise((resolve) => {
      this.mediaRecorder.onstop = async () => {
        if (this.stream) {
          this.stream.getTracks().forEach(t => t.stop());
        }
        this.isRecording = false;
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        
        try {
          const buffer = await blob.arrayBuffer();
          const folderPath = app.vault.getConfig("attachmentFolderPath") || "/";
          const dFolders = ["./", "/", ""];
          let normalizedFolder = dFolders.includes(folderPath) ? "" : folderPath;
          if (normalizedFolder && normalizedFolder.startsWith("./")) {
            normalizedFolder = normalizedFolder.substring(2);
          }
          
          if (normalizedFolder) {
            const folderExists = app.vault.getAbstractFileByPath(normalizedFolder);
            if (!folderExists) {
              await app.vault.createFolder(normalizedFolder);
            }
          }
          
          const fileName = `Voice-Comment-${window.moment().format("YYYYMMDD-HHmmss")}.webm`;
          const fullPath = normalizedFolder ? `${normalizedFolder}/${fileName}` : fileName;
          
          await app.vault.createBinary(fullPath, buffer);
          resolve(fileName);
        } catch(e) {
          console.error("[Core Habits] Failed to save voice note:", e);
          resolve(null);
        }
      };
      this.mediaRecorder.stop();
    });
  }
}
