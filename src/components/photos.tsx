import { useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';

/** Réduit une photo (max 1600 px, JPEG) pour qu'elle reste légère à stocker et à synchroniser. */
export async function compressImage(file: File, max = 1600, quality = 0.75): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Image illisible.')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}

export const MAX_PHOTOS = 4;

/** Ajout de photos (galerie, appareil photo, capture d'écran) avec aperçu. */
export function PhotoPicker({ photos, onChange }: { photos: string[]; onChange: (p: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: FileList | null) => {
    if (!files) return;
    const out = [...photos];
    for (const f of Array.from(files)) { if (out.length >= MAX_PHOTOS) break; if (f.type.startsWith('image/')) out.push(await compressImage(f)); }
    onChange(out);
    if (input.current) input.current.value = '';
  };
  return (
    <div className="photo-picker">
      {photos.map((p, i) => (
        <span key={i} className="photo-thumb"><img src={p} alt={`Photo ${i + 1}`} />
          <button aria-label="Retirer la photo" onClick={() => onChange(photos.filter((_, j) => j !== i))}><X size={14} /></button>
        </span>
      ))}
      {photos.length < MAX_PHOTOS && (
        <button className="btn sm" onClick={() => input.current?.click()}><ImagePlus size={16} /> Photo</button>
      )}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
    </div>
  );
}

/** Vignettes cliquables (ouvre en grand) + téléchargement pour les envoyer à Claude. */
export function PhotoStrip({ photos, name }: { photos?: string[]; name: string }) {
  if (!photos?.length) return null;
  return (
    <div className="photo-picker" style={{ marginTop: 6 }}>
      {photos.map((p, i) => (
        <a key={i} className="photo-thumb" href={p} download={`${name}-${i + 1}.jpg`} title="Télécharger la photo"><img src={p} alt={`Photo ${i + 1}`} /></a>
      ))}
    </div>
  );
}
