// P2 independent domain #2: course-session seat capacity and booking ledger.
// A bounded source document may vary only numeric/string constraints.
// Course schedule, payment, student identity and cancellation fees are DEFERRED.
import {renderBoundedCapacityTypeSpec} from "./bounded-capacity-renderer.mjs";
const profile="course-seat-lab/v0";
const operations=["createCourseSession","getCourseSession","listCourseSessions",
 "createSeatBooking","getSeatBooking","listSeatBookings","cancelSeatBooking","health"];
const permissions=new Set(["courses.read","courses.write","course-seats.read","course-seats.write","public"]);
const fail=(test,why)=>{if(!test)throw Error("COURSE_SEAT_IR_INVALID: "+why);};
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function keys(x,allowed,where){fail(object(x)&&Object.keys(x).length===allowed.length&&
 Object.keys(x).every(k=>allowed.includes(k)),where+" unexpected/missing attribute");}
function within(n,min,max,where){fail(Number.isSafeInteger(n)&&n>=min&&n<=max,where+" out of range");}
const field=(name,type,extra={})=>({name,type,required:true,nullable:false,...extra});
function source(p){
 keys(p,["profile","namespace","title","bounds"],"project");
 fail(p.profile===profile&&p.namespace==="CourseSeatLab","unsupported project profile");
 fail(typeof p.title==="string"&&p.title.trim()===p.title&&p.title.length>=2&&p.title.length<=120&&
  !/[\u0000-\u001f\u007f]/.test(p.title),"invalid service title");
 keys(p.bounds,["sessionCodeMaxLength","topicMaxLength","seatCapacityMax","bookingIdMaxLength","seatsPerBookingMax"],
  "course source bounds");
 const b=p.bounds;
 within(b.sessionCodeMaxLength,8,120,"session code length");
 within(b.topicMaxLength,8,255,"topic length");
 within(b.seatCapacityMax,7,100000,"seat capacity");
 within(b.bookingIdMaxLength,8,120,"booking ID length");
 within(b.seatsPerBookingMax,2,100,"seats per booking");
 fail(b.seatsPerBookingMax<=b.seatCapacityMax,"per-booking cap exceeds course max");
 return b;
}
export function courseSeatSemanticIr(project){
 const b=source(project);
 const entities=[
  {name:"CourseSession",view:"Course sessions and available seats",
   publicIdentity:"sessionCode",fields:[
    field("sessionCode","string",{unique:true,minLength:1,maxLength:b.sessionCodeMaxLength}),
    field("topic","string",{minLength:1,maxLength:b.topicMaxLength}),
    field("seatsAvailable","int32",{min:0,max:b.seatCapacityMax})
   ]},
  {name:"SeatBooking",view:"Seat bookings and cancellations",publicIdentity:"bookingId",fields:[
    field("bookingId","string",{unique:true,minLength:1,maxLength:b.bookingIdMaxLength}),
    field("sessionCode","string",{minLength:1,maxLength:b.sessionCodeMaxLength,
     reference:{target:"CourseSession",onDelete:"restrict"}}),
    field("seats","int32",{min:1,max:b.seatsPerBookingMax}),
    field("status","string",{initial:"confirmed"})
   ]}
 ];
 const op=(name,entity,kind,path,capability)=>({name,entity,kind,path,capability});
 const reserve={stockEntity:"CourseSession",availableField:"seatsAvailable",
  referenceField:"sessionCode",quantityField:"seats"};
 const graph=[
  op("createCourseSession","CourseSession","create","/api/course-sessions","courses.write"),
  op("getCourseSession","CourseSession","get","/api/course-sessions/{sessionCode}","courses.read"),
  op("listCourseSessions","CourseSession","listPage","/api/course-sessions","courses.read"),
  {...op("createSeatBooking","SeatBooking","create","/api/seat-bookings","course-seats.write"),
   reserve:{...reserve}},
  op("getSeatBooking","SeatBooking","get","/api/seat-bookings/{bookingId}","course-seats.read"),
  op("listSeatBookings","SeatBooking","listPage","/api/seat-bookings","course-seats.read"),
  {...op("cancelSeatBooking","SeatBooking","transition","/api/seat-bookings/{bookingId}/cancel","course-seats.write"),
   stateField:"status",from:"confirmed",to:"cancelled",release:{...reserve},audit:["status"]},
  op("health","CourseSession","health","/health","public")
 ];
 return {schemaVersion:"protocolia-course-seat-semantic-ir/v0.1",
  profile:project.profile,namespace:project.namespace,title:project.title,
  sourceBounds:{...b},entities,operations:graph};
}
export function validateCourseSeatSemanticIr(ir){
 keys(ir,["schemaVersion","profile","namespace","title","sourceBounds","entities","operations"],
  "course typed IR");
 fail(ir.schemaVersion==="protocolia-course-seat-semantic-ir/v0.1"&&
  ir.profile===profile&&ir.namespace==="CourseSeatLab","wrong IR profile");
 const approved=courseSeatSemanticIr({profile:ir.profile,namespace:ir.namespace,
  title:ir.title,bounds:ir.sourceBounds});
 fail(JSON.stringify(ir)===JSON.stringify(approved),"semantic graph differs from trusted course profile");
 fail(ir.operations.map(x=>x.name).join(",")===operations.join(","),"unreviewed operations");
 fail(ir.operations.every(x=>permissions.has(x.capability)),"unknown course capability");
 return ir;
}
export function emitCourseSeatTypeSpec(ir){
 validateCourseSeatSemanticIr(ir);
 return renderBoundedCapacityTypeSpec(ir,{CourseSession:"session",SeatBooking:"booking"});
}
