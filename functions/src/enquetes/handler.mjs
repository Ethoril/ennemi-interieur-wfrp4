import { HttpsError } from 'firebase-functions/v2/https';
import { EnqueteError } from './domain.mjs';
import { getEnqueteSession, saveEnqueteCommand, enquiryRead, finalizeEnqueteFile } from './service.mjs';
export function createEnqueteHandlers(getDependencies) {
  const wrap=action=>async request=>{
    try{return await action(request,getDependencies());}
    catch(error){if(error instanceof EnqueteError)throw new HttpsError(error.code,error.message,error.details);throw new HttpsError('internal','Opération impossible ; votre brouillon reste disponible');}
  };
  return { session:wrap(getEnqueteSession), command:wrap((r,d)=>saveEnqueteCommand(r.data,r,d)), read:wrap(enquiryRead), file:wrap(finalizeEnqueteFile) };
}

