/* global process, console */
import fs from 'fs';
import path from 'path';

const srcDir = path.join(process.cwd(), 'src');

const findFiles = (dir, fileList = []) => {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findFiles(filePath, fileList);
    } else if (filePath.endsWith('.ts')) {
      fileList.push(filePath);
    }
  }
  return fileList;
};

const allFiles = findFiles(srcDir);

for (const file of allFiles) {
  let content = fs.readFileSync(file, 'utf-8');
  let changed = false;

  if (content.includes("req.app.get('supabaseAdmin')")) {
    content = content.replace(/req\.app\.get\('supabaseAdmin'\)( as SupabaseClient)?;?/g, 'getSupabase();');
    
    // Add import statement at the top
    const depth = path.relative(path.dirname(file), path.join(srcDir, 'config', 'supabase.ts')).replace(/\\/g, '/');
    const importPath = depth.startsWith('.') ? depth : `./${depth}`;
    
    // insert import
    if (!content.includes('getSupabase')) {
      // it should include it now because we just replaced it, but let's check for the import
    }
    if (!content.includes("import { getSupabase }")) {
      content = `import { getSupabase } from '${importPath}';\n` + content;
    }
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, content, 'utf-8');
    console.log(`Updated ${file}`);
  }
}
