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

export default upload;
