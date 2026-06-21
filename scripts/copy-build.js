import fs from 'fs';
import path from 'path';

const filesToCopy = ['main.js', 'styles.css'];
const srcDir = './dist';
const destDir = '.';

try {
  filesToCopy.forEach(file => {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);
    
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`Successfully copied ${file} to project root.`);
    } else {
      console.warn(`Warning: source file ${srcPath} does not exist.`);
    }
  });
} catch (err) {
  console.error('Error during post-build file copy:', err);
  process.exit(1);
}
