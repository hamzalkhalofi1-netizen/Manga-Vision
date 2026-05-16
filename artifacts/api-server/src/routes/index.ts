import { Router, type IRouter } from "express";
import healthRouter from "./health";
import translateRouter from "./translate";
import mangaProxyRouter from "./manga-proxy";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/translate", translateRouter);
router.use("/manga-proxy", mangaProxyRouter);

export default router;
