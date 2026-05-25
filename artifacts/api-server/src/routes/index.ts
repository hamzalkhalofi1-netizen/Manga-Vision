import { Router, type IRouter } from "express";
import healthRouter from "./health";
import translateRouter from "./translate";
import translateImageRouter from "./translate-image";
import mangaProxyRouter from "./manga-proxy";
import sourceProxyRouter from "./source-proxy";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/translate", translateRouter);
router.use("/translate-image", translateImageRouter);
router.use("/manga-proxy", mangaProxyRouter);
router.use("/source-proxy", sourceProxyRouter);

export default router;
