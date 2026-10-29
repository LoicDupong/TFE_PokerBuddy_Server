import { parseRange } from "../utils/analytics.utils.js";
import { buildOverview } from "../utils/analyticsReport.utils.js";

const adminAnalyticsController = {
    overview: async (req, res) => {
        try {
            const range = parseRange({
                from: typeof req.query.from === "string" ? req.query.from : undefined,
                to: typeof req.query.to === "string" ? req.query.to : undefined,
            });
            if (range.error) return res.status(400).json({ error: range.error });
            return res.status(200).json(await buildOverview(range));
        } catch (error) {
            console.error("admin analytics overview error:", error);
            return res.status(500).json({ error: "Error computing analytics" });
        }
    },
};

export default adminAnalyticsController;
