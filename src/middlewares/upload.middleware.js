import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

// Avatars sur Cloudinary quand CLOUDINARY_URL est défini (prod) : le disque de Render est effacé
// à chaque déploiement. Sans la variable (dev local), ils restent dans uploads/avatars/
const useCloudinary = Boolean(process.env.CLOUDINARY_URL);
if (useCloudinary) cloudinary.config({ secure: true }); // identifiants lus dans CLOUDINARY_URL

const AVATAR_FOLDER = "pokerbuddy/avatars";

const upload = multer({
  // En mémoire pour Cloudinary : le fichier n'est envoyé qu'une fois le profil validé
  ...(useCloudinary ? { storage: multer.memoryStorage() } : { dest: "uploads/avatars/" }),
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

/**
 * Enregistre l'avatar reçu par uploadAvatar et renvoie la valeur à stocker dans user.avatar :
 * URL Cloudinary complète, ou chemin local /uploads/avatars/… en dev.
 * Un seul fichier par utilisateur sur Cloudinary (public_id = id) : un nouvel avatar remplace l'ancien.
 */
export async function storeAvatar(file, userId) {
  if (!useCloudinary) return `/uploads/avatars/${file.filename}`;

  const result = await new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: AVATAR_FOLDER,
          public_id: userId,
          overwrite: true,
          invalidate: true,
          resource_type: "image",
          // Carré 256 px centré sur le visage : l'image d'origine (jusqu'à 2 Mo) n'est pas gardée
          transformation: [{ width: 256, height: 256, crop: "fill", gravity: "face" }],
        },
        (error, uploaded) => (error ? reject(error) : resolve(uploaded))
      )
      .end(file.buffer);
  });
  return result.secure_url;
}

// Suppression du compte : la photo ne doit pas rester en ligne (sans effet en dev local)
export async function removeAvatar(userId) {
  if (!useCloudinary) return;
  await cloudinary.uploader.destroy(`${AVATAR_FOLDER}/${userId}`, { invalidate: true });
}

export default upload;
