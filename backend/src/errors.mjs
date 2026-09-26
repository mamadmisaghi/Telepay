export class HttpError extends Error {constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
export const need=(condition,status,message)=>{if(!condition)throw new HttpError(status,message);};
