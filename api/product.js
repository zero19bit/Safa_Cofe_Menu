import { serve } from '../server/vercel.mjs';
export default (req,res)=>serve(req,res,'/api/product');
