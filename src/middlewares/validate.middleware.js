import { isUuid } from "../utils/validation.utils.js";

// Pour router.param : un id mal formé ferait planter Postgres ("invalid input syntax for type uuid")
// et renverrait une 500 ; on répond 404 comme pour un id inexistant
export function uuidParam(req, res, next, value) {
    if (!isUuid(value)) {
        return res.status(404).json({ error: "Not found" });
    }
    next();
}
