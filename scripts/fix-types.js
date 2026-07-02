import fs from 'fs';

const filePath = 'apps/frontend/src/services/api.ts';
let content = fs.readFileSync(filePath, 'utf-8');

content = content.replace(/signature\?: any/g, 'signature?: string | number[]');
content = content.replace(/signature: any/g, 'signature: string | number[]');
content = content.replace(/adminAuth: any/g, 'adminAuth: Record<string, string>');
content = content.replace(/badge: any/g, 'badge: Record<string, unknown>');
content = content.replace(/metadata: any/g, 'metadata: Record<string, unknown>');
content = content.replace(/config: any/g, 'config: Record<string, unknown>');
content = content.replace(/payload: any, adminAuth:/g, 'payload: Record<string, unknown>, adminAuth:');
content = content.replace(/settings: Record<string, any>/g, 'settings: Record<string, unknown>');
content = content.replace(/badges: any\[\]/g, 'badges: Record<string, unknown>[]');
content = content.replace(/Promise<any>/g, 'Promise<unknown>');
content = content.replace(/<any>/g, '<unknown>');
content = content.replace(/holders: any\[\]/g, 'holders: unknown[]');
content = content.replace(/awards: any\[\]/g, 'awards: unknown[]');
content = content.replace(/catch \(error: any\)/g, 'catch (error: unknown)');

fs.writeFileSync(filePath, content);
console.log('Fixed types in ' + filePath);
