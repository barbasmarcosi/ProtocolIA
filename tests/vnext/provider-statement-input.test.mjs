import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadStatementArray as load} from "../../packages/adapters/provider-statement-input.mjs";

test("real regular UTF-8 JSON array is accepted; malformed bytes and symlinks fail closed",()=>{
  const dir=mkdtempSync(join(tmpdir(),"pia-input-"));
  try {
    const file=join(dir,"statement.json");
    writeFileSync(file,'[{"amount":"0.30"}]');
    assert.deepEqual(load(file,"statement"),[{amount:"0.30"}]);
    writeFileSync(file,Buffer.from([0x5b,0xff,0x5d]));
    assert.throws(()=>load(file,"statement"),/invalid JSON or UTF-8/);
    writeFileSync(file,'{"not":"array"}');
    assert.throws(()=>load(file,"statement"),/expected JSON array/);
    const link=join(dir,"linked.json");
    symlinkSync(file,link);
    assert.throws(()=>load(link,"statement"),/non-symlink/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

const meta=(ino,mtimeMs=1)=>({
  isFile:()=>true,isSymbolicLink:()=>false,
  dev:17,ino,size:2,mtimeMs,ctimeMs:1
});
test("deterministically rejects same-path regular-file inode swap after lstat",()=>{
  let closed=0,read=0;
  const io={
    lstatSync:()=>meta(101),
    openSync:()=>77,
    fstatSync:()=>meta(102),
    readSync:()=>{read++;return 0;},
    closeSync:fd=>{assert.equal(fd,77);closed++;}
  };
  assert.throws(()=>load("synthetic.json","statement",io),
    /input identity changed before read/);
  assert.equal(read,0,"replaced inode must never be parsed");
  assert.equal(closed,1,"descriptor must close on rejection");
});

test("detects mutation after opening the correct inode; always closes descriptor",()=>{
  let closed=0,stats=0,reads=0;
  const io={
    lstatSync:()=>meta(101),
    openSync:()=>77,
    fstatSync:()=>++stats===1?meta(101):meta(101,2),
    readSync:(_fd,buf,offset)=>{
      if(reads++)return 0;
      Buffer.from("[]").copy(buf,offset);
      return 2;
    },
    closeSync:()=>{closed++;}
  };
  assert.throws(()=>load("synthetic.json","statement",io),/input changed during read/);
  assert.equal(stats,2);
  assert.equal(closed,1);
});

test("same inode and stable metadata are accepted by the fault-injection seam",()=>{
  let reads=0,closed=0;
  const io={
    lstatSync:()=>meta(101),
    openSync:()=>77,
    fstatSync:()=>meta(101),
    readSync:(_fd,buf,offset)=>{
      if(reads++)return 0;
      Buffer.from("[]").copy(buf,offset);
      return 2;
    },
    closeSync:()=>{closed++;}
  };
  assert.deepEqual(load("synthetic.json","statement",io),[]);
  assert.equal(closed,1);
});
