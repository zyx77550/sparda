import express from "express"; const a=express(); a.get("/x",(q,r)=>r.json({})); a.listen(3000);
