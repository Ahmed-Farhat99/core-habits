export class VoiceRecorderUtility {
  static isRecording = false;
  static mediaRecorder = null;
  static stream = null;
  static chunks = [];

  static getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg;codecs=opus',
      'audio/wav'
    ];
    for (const type of types) {
      if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
        if (MediaRecorder.isTypeSupported(type)) return type;
      }
    }
    return '';
  }

  static getAudioExtension(mimeType) {
    if (!mimeType) return 'webm';
    if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'mp4';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('wav')) return 'wav';
    return 'webm';
  }

  static async startRecording() {
    if (this.isRecording) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = this.getSupportedMimeType();
      const options = mimeType ? { mimeType } : undefined;
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this._activeMimeType = mimeType;
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

  static async stopAndSaveRecording(app, customName = null) {
    if (!this.isRecording || !this.mediaRecorder) return null;
    
    return new Promise((resolve) => {
      this.mediaRecorder.onstop = async () => {
        if (this.stream) {
          this.stream.getTracks().forEach(t => t.stop());
        }
        this.isRecording = false;
        const mimeType = this._activeMimeType || 'audio/webm';
        const ext = this.getAudioExtension(mimeType);
        const blob = new Blob(this.chunks, mimeType ? { type: mimeType } : undefined);
        this.chunks = []; // Clear memory
        
        try {
          const timestamp = window.moment ? window.moment().format("YYYY-MM-DD_HHmmss") : Date.now();
          const fileName = customName ? `${customName}.${ext}` : `Recording-${timestamp}.${ext}`;
          const buffer = await blob.arrayBuffer();
          let fullPath;
          if (typeof app?.fileManager?.getAvailablePathForAttachment === "function") {
            fullPath = await app.fileManager.getAvailablePathForAttachment(fileName);
          } else {
            const folderPath = (typeof app.vault?.getConfig === "function" ? app.vault.getConfig("attachmentFolderPath") : null) || "/";
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
            fullPath = normalizedFolder ? `${normalizedFolder}/${fileName}` : fileName;
          }
          
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

  static cancelRecording() {
    if (this.mediaRecorder) {
      try {
        this.mediaRecorder.onstop = null;
        this.mediaRecorder.ondataavailable = null;
        if (this.mediaRecorder.state !== "inactive") {
          this.mediaRecorder.stop();
        }
      } catch {
        // ignore
      }
      this.mediaRecorder = null;
    }
    if (this.stream) {
      try {
        this.stream.getTracks().forEach(t => t.stop());
      } catch {
        // ignore
      }
      this.stream = null;
    }
    this.chunks = [];
    this.isRecording = false;
  }
}
