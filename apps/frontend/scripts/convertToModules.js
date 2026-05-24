import fs from 'fs';
import path from 'path';

const filePaths = process.argv.slice(2);

if (filePaths.length === 0) {
  console.error('Please provide file paths to process.');
  process.exit(1);
}

filePaths.forEach((relPath) => {
  const filePath = path.resolve(process.cwd(), relPath);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf-8');

  // Add the styles import if it doesn't exist
  const fileName = path.basename(filePath, '.tsx');
  const importStatement = `import styles from './${fileName}.module.css';\n`;
  
  // Remove old CSS import
  content = content.replace(new RegExp(`import ["']./${fileName}.css["'];?\\n?`, 'g'), '');
  
  if (!content.includes('import styles from')) {
    // Insert after the last import
    const lastImportIndex = content.lastIndexOf('import ');
    if (lastImportIndex !== -1) {
      const endOfLine = content.indexOf('\n', lastImportIndex);
      content = content.slice(0, endOfLine + 1) + importStatement + content.slice(endOfLine + 1);
    } else {
      content = importStatement + content;
    }
  }

  // 1. Replace static strings: className="foo bar"
  content = content.replace(/className="([^"]+)"/g, (match, classes) => {
    const parts = classes.split(' ').filter(Boolean);
    if (parts.length === 1) {
      return `className={styles['${parts[0]}']}`;
    }
    return `className={\`${parts.map(p => `\${styles['${p}']}`).join(' ')}\`}`;
  });

  // 2. Replace static string expressions: className={'foo'}
  content = content.replace(/className=\{'([^']+)'\}/g, (match, classes) => {
    const parts = classes.split(' ').filter(Boolean);
    if (parts.length === 1) {
      return `className={styles['${parts[0]}']}`;
    }
    return `className={\`${parts.map(p => `\${styles['${p}']}`).join(' ')}\`}`;
  });

  fs.writeFileSync(filePath, content);
  console.log(`Successfully converted ${fileName}.tsx to CSS modules.`);
});
