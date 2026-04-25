const fs = require('fs');

// Patch src/main.js
let src = fs.readFileSync('src/main.js', 'utf8');

const audioHack = `
                  audioEl.addEventListener('loadedmetadata', () => {
                    if (audioEl.duration === Infinity || isNaN(audioEl.duration)) {
                      audioEl.currentTime = 1e101;
                      audioEl.addEventListener('timeupdate', function f() {
                        audioEl.currentTime = 0;
                        audioEl.removeEventListener('timeupdate', f);
                      });
                    }
                  });
`;

src = src.replace(
  'const audioEl = entryDiv.createEl("audio", { attr: { controls: true, src: src } });',
  'const audioEl = entryDiv.createEl("audio", { attr: { controls: true, src: src } });' + audioHack
);

src = src.replace(
  'const audioEl = bodyEl.createEl("audio", { attr: { controls: true, src: src } });',
  'const audioEl = bodyEl.createEl("audio", { attr: { controls: true, src: src } });' + audioHack.replace(/audioEl/g, 'audioEl')
);

fs.writeFileSync('src/main.js', src);
console.log('src/main.js patched for audio duration!');

// Rebuild main.js (since src/main.js was modified, we should rebuild if possible, or patch main.js directly).
// Wait, the user builds the plugin somehow? `npm run build`?
// Let's see if we can just patch `main.js` too.
let dist = fs.readFileSync('main.js', 'utf8');
// The minified code probably has `controls:!0`
dist = dist.replace(
    /createEl\("audio",\{attr:\{controls:(true|!0),src:([a-zA-Z0-9_]+)\}\}\)/g,
    'createEl("audio",{attr:{controls:true,src:$2}});$2_audioHack=arguments[0]||this;if(arguments[0])arguments[0].addEventListener("loadedmetadata",()=>{if(arguments[0].duration===Infinity||isNaN(arguments[0].duration)){arguments[0].currentTime=1e101;arguments[0].addEventListener("timeupdate",function f(){arguments[0].currentTime=0;arguments[0].removeEventListener("timeupdate",f)})}})'
);
// Actually, regex replace on minified JS is risky. I'll just run npm run build if `package.json` has a build script.
