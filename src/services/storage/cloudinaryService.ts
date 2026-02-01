import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";
import { config } from "../../config"; 

cloudinary.config({
  cloud_name: config.CLOUDNAME,
  api_key: config.CLOUD_API_KEY,
  api_secret: config.CLOUD_API_SECRET,
});

class CloudinaryService {
  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    folder: string = "audio"
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: "video",
          folder,
          public_id: filename,
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject("No result from Cloudinary");

          resolve(result.secure_url);
        }
      );

      const stream = Readable.from(buffer);
      stream.pipe(uploadStream);
    });
  }
}

export default new CloudinaryService();
