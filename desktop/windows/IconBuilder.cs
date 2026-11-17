using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

internal static class IconBuilder
{
    private static void Main(string[] args)
    {
        int[] sizes = { 16, 20, 24, 32, 40, 48, 64, 128, 256 };
        using (var source = Image.FromFile(args[0]))
        using (var output = new BinaryWriter(File.Open(args[1], FileMode.CreateNew)))
        {
            var images = new byte[sizes.Length][];
            for (int i = 0; i < sizes.Length; i++)
                images[i] = Frame(source, sizes[i]);
            output.Write((short)0);
            output.Write((short)1);
            output.Write((short)sizes.Length);
            int offset = 6 + 16 * sizes.Length;
            for (int i = 0; i < sizes.Length; i++)
            {
                output.Write((byte)(sizes[i] % 256));
                output.Write((byte)(sizes[i] % 256));
                output.Write((short)0);
                output.Write((short)1);
                output.Write((short)32);
                output.Write(images[i].Length);
                output.Write(offset);
                offset += images[i].Length;
            }
            foreach (byte[] image in images) output.Write(image);
        }
    }

    private static byte[] Frame(Image source, int size)
    {
        using (var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        using (var canvas = Graphics.FromImage(bitmap))
        using (var buffer = new MemoryStream())
        using (var frame = new BinaryWriter(buffer))
        {
            float scale = Math.Min((float)size / source.Width, (float)size / source.Height);
            float width = source.Width * scale, height = source.Height * scale;
            canvas.Clear(Color.Transparent);
            canvas.CompositingMode = CompositingMode.SourceCopy;
            canvas.InterpolationMode = InterpolationMode.HighQualityBicubic;
            canvas.PixelOffsetMode = PixelOffsetMode.HighQuality;
            canvas.DrawImage(source, (size - width) / 2, (size - height) / 2, width, height);
            frame.Write(40);
            frame.Write(size);
            frame.Write(size * 2);
            frame.Write((short)1);
            frame.Write((short)32);
            frame.Write(0);
            frame.Write(size * size * 4);
            for (int field = 0; field < 4; field++) frame.Write(0);
            int maskStride = ((size + 31) / 32) * 4;
            var mask = new byte[maskStride * size];
            for (int row = 0; row < size; row++)
            {
                for (int x = 0; x < size; x++)
                {
                    Color pixel = bitmap.GetPixel(x, size - row - 1);
                    frame.Write(pixel.ToArgb());
                    if (pixel.A == 0) mask[row * maskStride + x / 8] |= (byte)(0x80 >> (x % 8));
                }
            }
            frame.Write(mask);
            frame.Flush();
            return buffer.ToArray();
        }
    }
}
