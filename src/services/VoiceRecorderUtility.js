import fixWebmDuration from 'fix-webm-duration';

const getFixWebmDuration = () => {
  if (typeof fixWebmDuration === 'function') return fixWebmDuration;
  if (fixWebmDuration && typeof fixWebmDuration.default === 'function') return fixWebmDuration.default;
  return null;
};

export class VoiceRecorderUtility {
  static isRecording = false;
  static _isStarting = false;
  static mediaRecorder = null;
  static stream = null;
  static chunks = [];
  static startTime = null;

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
    if (this.isRecording || this._isStarting) return false;
    this._isStarting = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = this.getSupportedMimeType();
      const options = mimeType ? { mimeType } : undefined;
      
      let recorder = null;
      if (options) {
        try {
          recorder = new MediaRecorder(this.stream, options);
        } catch (optErr) {
          console.warn("[Core Habits] MediaRecorder failed with options, falling back to default:", optErr);
        }
      }
      if (!recorder) {
        recorder = new MediaRecorder(this.stream);
      }
      this.mediaRecorder = recorder;
      this._activeMimeType = mimeType;
      this.chunks = [];
      this.mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };

      // Listen for unexpected track disconnects (e.g. Bluetooth headset battery or disconnect)
      if (this.stream) {
        const tracks = typeof this.stream.getAudioTracks === 'function' 
          ? this.stream.getAudioTracks() 
          : (typeof this.stream.getTracks === 'function' ? this.stream.getTracks() : []);
        tracks.forEach(track => {
          track.onended = () => {
            if (this.isRecording) {
              console.warn("[Core Habits] Audio track ended unexpectedly (e.g. Bluetooth/device disconnect).");
            }
          };
        });
      }

      this.mediaRecorder.start();
      this.startTime = Date.now();
      this.isRecording = true;
      return true;
    } catch (e) {
      if (this.stream) {
        try {
          this.stream.getTracks().forEach(t => t.stop());
        } catch { /* ignore */ }
        this.stream = null;
      }
      this.cancelRecording();
      console.error("[Core Habits] Failed to start voice recording:", e);
      return false;
    } finally {
      this._isStarting = false;
    }
  }

  static async stopAndSaveRecording(app, customName = null, explicitDurationMs = null) {
    if (!this.isRecording || !this.mediaRecorder) return null;
    
    let durationMs = 0;
    if (this.startTime) {
      durationMs = Math.max(0, Date.now() - this.startTime);
    }
    if (!durationMs && typeof explicitDurationMs === 'number' && explicitDurationMs > 0) {
      durationMs = explicitDurationMs;
    }
    this.startTime = null;

    return new Promise((resolve) => {
      const recorder = this.mediaRecorder;
      const stream = this.stream;

      recorder.onstop = async () => {
        if (stream) {
          try {
            stream.getTracks().forEach(t => t.stop());
          } catch { /* ignore */ }
        }
        if (this.stream === stream) {
          this.stream = null;
        }
        if (this.mediaRecorder === recorder) {
          this.mediaRecorder = null;
        }
        this.isRecording = false;
        const mimeType = this._activeMimeType || 'audio/webm';
        const ext = this.getAudioExtension(mimeType);
        let blob = new Blob(this.chunks, mimeType ? { type: mimeType } : undefined);
        this.chunks = []; // Clear memory
        
        if (ext === 'webm' && durationMs > 0) {
          try {
            const fixer = getFixWebmDuration();
            if (fixer) {
              blob = await fixer(blob, durationMs, { logger: false });
            }
          } catch (err) {
            console.warn("[Core Habits] Failed to patch WebM duration:", err);
          }
        }

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
          
          const savedName = fullPath ? fullPath.split("/").pop() : fileName;
          await app.vault.createBinary(fullPath, buffer);
          resolve(savedName);
        } catch(e) {
          console.error("[Core Habits] Failed to save voice note:", e);
          resolve(null);
        }
      };

      try {
        if (recorder.state !== "inactive") {
          recorder.stop();
        } else if (typeof recorder.onstop === "function") {
          recorder.onstop();
        }
      } catch (stopErr) {
        console.error("[Core Habits] Error stopping mediaRecorder:", stopErr);
        if (typeof recorder.onstop === "function") {
          recorder.onstop();
        } else {
          resolve(null);
        }
      }
    });
  }

  static cancelRecording() {
    this.startTime = null;
    this._isStarting = false;
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
