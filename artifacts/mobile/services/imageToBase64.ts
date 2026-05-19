const IMAGE_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": "https://mangadex.org/",
  "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

export interface ImagePayload {
  imageData: string;
  mimeType: string;
}

export async function fetchImageAsBase64(url: string): Promise<ImagePayload> {
  const response = await fetch(url, { headers: IMAGE_FETCH_HEADERS });
  if (!response.ok) {
    throw new Error(`Image fetch failed with status ${response.status}`);
  }

  const blob = await response.blob();
  const mimeType = (blob.type || "image/jpeg").split(";")[0];

  return new Promise<ImagePayload>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      if (!base64) {
        reject(new Error("FileReader produced empty base64"));
        return;
      }
      resolve({ imageData: base64, mimeType });
    };
    reader.onerror = () => reject(new Error("FileReader error reading image blob"));
    reader.readAsDataURL(blob);
  });
}
