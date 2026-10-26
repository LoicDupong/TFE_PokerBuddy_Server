import multer from "multer";

const upload = multer({
  dest: "uploads/avatars/", // dossier local
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only .png or .jpg allowed"));
    }
    cb(null, true);
  },
});

// Upload d'avatar avec erreurs renvoyées en 400 JSON (sinon multer passe l'erreur à Express → 500)
export function uploadAvatar(req, res, next) {
  upload.single("avatar")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "Image too large (max 2MB)" : err.message;
      return res.status(400).json({ error: message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

export default upload;
