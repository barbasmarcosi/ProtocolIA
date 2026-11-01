// Bounded, read-only snapshot loader for operator-supplied financial data.
// This validates the inode opened, not merely the pathname inspected earlier.
// File integrity is NOT proof that a bank or provider authored the contents.
import {openSync,closeSync,fstatSync,lstatSync,readSync,constants} from "node:fs";
import {resolve} from "node:path";

export const MAX_STATEMENT_INPUT_BYTES=4*1024*1024;

// JSON.parse silently accepts duplicate object members and keeps the last
// value. Financial inputs must not depend on that parser-specific precedence:
// e.g. {"amount":"100.00","amount":"1.00"} is ambiguous evidence.
// Validate syntax with the native parser first, then scan string tokens to
// reject repeated *decoded* keys within the same object (including Unicode
// escape aliases). Keys may legitimately recur in different array rows.
function parseUnambiguousJson(text) {
  const parsed=JSON.parse(text);
  const frames=[];
  for(let i=0;i<text.length;) {
    const ch=text[i];
    if(ch==='"') {
      const start=i++;
      while(i<text.length) {
        if(text[i]==="\\") {i+=2;continue;}
        if(text[i++]==='"') break;
      }
      let next=i;
      while(next<text.length && /[\t\n\r ]/.test(text[next]))next++;
      if(text[next]===":") {
        const keys=frames[frames.length-1];
        if(!(keys instanceof Set))throw Error("ambiguous JSON structure");
        const key=JSON.parse(text.slice(start,i));
        if(keys.has(key))throw Error("ambiguous duplicate JSON member");
        keys.add(key);
      }
    } else if(ch==="{" || ch==="[") {
      if(frames.length>=64)throw Error("excessive JSON nesting");
      frames.push(ch==="{" ? new Set() : null);
      i++;
    } else if(ch==="}" || ch==="]") {
      frames.pop();i++;
    } else i++;
  }
  return parsed;
}

const realIO={openSync,closeSync,fstatSync,lstatSync,readSync};

export function loadStatementArray(file,name,io=realIO) {
  const path=resolve(file);
  let initial,fd;
  try {
    initial=io.lstatSync(path);
    if(!initial.isFile() || initial.isSymbolicLink())
      throw Error("not regular");
    // O_NOFOLLOW protects the final component against symlink replacement.
    // O_NONBLOCK prevents a substituted FIFO from blocking the operator CLI.
    fd=io.openSync(path,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw Error(name + ": input must be an accessible regular, non-symlink file");
  }
  let data;
  try {
    const stat=io.fstatSync(fd);
    if(!stat.isFile() || stat.size<0 || stat.size>MAX_STATEMENT_INPUT_BYTES)
      throw Error(name + ": input must be a regular file <= 4 MiB");
    // A same-path regular-file swap between lstat and open used to be accepted.
    // Compare actual device/inode before parsing even a single financial byte.
    if(initial.dev!==stat.dev || initial.ino!==stat.ino)
      throw Error(name + ": input identity changed before read");
    const buffer=Buffer.allocUnsafe(stat.size+1);
    let used=0;
    while(used<buffer.length) {
      const count=io.readSync(fd,buffer,used,buffer.length-used,null);
      if(count===0)break;
      used+=count;
    }
    const after=io.fstatSync(fd);
    if(used>MAX_STATEMENT_INPUT_BYTES || used!==stat.size ||
       after.dev!==stat.dev || after.ino!==stat.ino ||
       after.size!==stat.size || after.mtimeMs!==stat.mtimeMs ||
       after.ctimeMs!==stat.ctimeMs)
      throw Error(name + ": input changed during read or exceeded 4 MiB");
    try {
      const text=new TextDecoder("utf-8",{fatal:true}).decode(buffer.subarray(0,used));
      data=parseUnambiguousJson(text);
    } catch(error) {
      // No parser error may echo a financial field name, value or file bytes.
      if(error?.message==="ambiguous duplicate JSON member")
        throw Error(name + ": duplicate JSON object member");
      if(error?.message==="excessive JSON nesting")
        throw Error(name + ": excessive JSON nesting");
      throw Error(name + ": invalid JSON or UTF-8");
    }
  } finally {
    io.closeSync(fd);
  }
  if(!Array.isArray(data)) throw Error(name + ": expected JSON array");
  return data;
}
