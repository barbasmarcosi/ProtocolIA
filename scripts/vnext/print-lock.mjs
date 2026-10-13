import { readFileSync } from "node:fs";
const text=readFileSync("package-lock.json").toString("base64");
const chunkSize=2200;
const parts=Math.ceil(text.length/chunkSize);
for(let i=0;i<parts;i++){
  console.log("A0_LOCK_PART "+(i+1)+"/"+parts+" "+text.slice(i*chunkSize,(i+1)*chunkSize));
}
console.log("A0_LOCK_CAPTURE_END total="+parts);
