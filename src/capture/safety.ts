import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { DomainError } from './candidate-store.js';

export const captureBytes = 65536;
export function screenCapture(text: string, maximum = captureBytes): void {
  if (typeof text!=='string' || Buffer.byteLength(text,'utf8')>maximum || text.includes('\0') || Buffer.from(text,'utf8').toString('utf8')!==text)
    throw new DomainError('VALIDATION_ERROR','Capture must be valid bounded UTF-8 text.');
  if (/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b|\b(?:password|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"']{16,}/i.test(text))
    throw new DomainError('VALIDATION_ERROR','Capture contains recognizable credential material; remove it before retrying.');
}

// Validate every existing ancestor, including missing-directory creation targets.
// These checks reject links/junctions; they do not replace OS isolation from a
// hostile process able to rename trusted directories between system calls.
export function safePath(filename: string, root: string): string {
  filename=path.resolve(filename); root=path.resolve(root);
  if (filename!==root && !filename.startsWith(root+path.sep)) throw new DomainError('FORBIDDEN','Capture path escapes its configured root.');
  let ancestor=filename;
  while (true) {
    if (existsSync(ancestor)) {
      if (lstatSync(ancestor).isSymbolicLink() || realpathSync(ancestor)!==ancestor) throw new DomainError('FORBIDDEN','Capture paths must not resolve through links.');
      if (ancestor!==filename && !lstatSync(ancestor).isDirectory()) throw new DomainError('FORBIDDEN','Capture parent must be a directory.');
    }
    const parent=path.dirname(ancestor); if(parent===ancestor) break; ancestor=parent;
  }
  return filename;
}
export function safeDirectory(directory: string, root: string): void {
  safePath(directory,root); mkdirSync(directory,{recursive:true}); safePath(directory,root);
  if(!lstatSync(directory).isDirectory()) throw new DomainError('FORBIDDEN','Capture directory is not a directory.');
}
export function readCapture(filename: string, root: string, maximum=captureBytes): string {
  safePath(filename,root);
  if(!lstatSync(filename).isFile()) throw new DomainError('FORBIDDEN','Capture input must be a regular file.');
  const descriptor=openSync(filename,'r');
  try {
    const before=fstatSync(descriptor);
    if(!before.isFile() || before.size>maximum) throw new DomainError('VALIDATION_ERROR','Capture input exceeds its byte limit.');
    const bytes=readFileSync(descriptor); const after=lstatSync(filename); safePath(filename,root);
    if(before.dev!==after.dev || before.ino!==after.ino || bytes.length>maximum || before.size!==after.size || before.mtimeMs!==after.mtimeMs)
      throw new DomainError('CONFLICT','Capture input changed while reading.');
    const text=bytes.toString('utf8');
    if(!Buffer.from(text).equals(bytes)) throw new DomainError('VALIDATION_ERROR','Capture input is not valid UTF-8.');
    return text;
  } finally {closeSync(descriptor);}
}
