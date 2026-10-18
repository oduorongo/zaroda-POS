import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { ProductImagesService, productImagePrefix } from './product-images.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const PRODUCT = '33333333-3333-3333-3333-333333333333';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(100)]);

function setup(imageCount = 0) {
  const tx = {
    product: { findUnique: jest.fn().mockResolvedValue({ id: PRODUCT }) },
    productImage: {
      count: jest.fn().mockResolvedValue(imageCount),
      findMany: jest.fn().mockResolvedValue(Array.from({ length: imageCount }, (_, i) => ({ sortOrder: i }))),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'img-1', ...data })),
    },
  };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const storage = {
    upload: jest.fn().mockResolvedValue(undefined),
    deleteMany: jest.fn().mockResolvedValue(undefined),
    publicUrl: jest.fn((key: string) => `https://cdn.example/${key}`),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new ProductImagesService(tenantPrisma as any, storage as any);
  return { service, tx, storage };
}

const asTenant = <T>(fn: () => Promise<T>) =>
  tenantContext.run({ organizationId: ORG, orgUserId: 'ou-1', role: Role.OWNER }, fn);

describe('ProductImagesService', () => {
  describe('upload', () => {
    it('stores the photo under this tenant and product, after existing photos', async () => {
      const { service, storage, tx } = setup(2);
      const image = await asTenant(() => service.upload(PRODUCT, 'image/png', PNG));
      const [key, body, type] = storage.upload.mock.calls[0];
      expect(key.startsWith(productImagePrefix(ORG, PRODUCT))).toBe(true);
      expect(key.endsWith('.png')).toBe(true);
      expect(body).toBe(PNG);
      expect(type).toBe('image/png');
      expect(image).toEqual({ id: 'img-1', url: `https://cdn.example/${key}`, sortOrder: 2 });
      expect(tx.productImage.create).toHaveBeenCalled();
    });

    it('accepts jpeg and webp', async () => {
      const { service } = setup();
      await expect(asTenant(() => service.upload(PRODUCT, 'image/jpeg', JPEG))).resolves.toBeDefined();
      await expect(asTenant(() => service.upload(PRODUCT, 'image/webp', WEBP))).resolves.toBeDefined();
    });

    it('rejects non-image types, empty and oversized files without touching storage', async () => {
      const { service, storage } = setup();
      await expect(asTenant(() => service.upload(PRODUCT, 'application/pdf', JPEG))).rejects.toThrow(BadRequestException);
      await expect(asTenant(() => service.upload(PRODUCT, 'image/jpeg', Buffer.alloc(0)))).rejects.toThrow(/empty/);
      await expect(asTenant(() => service.upload(PRODUCT, 'image/jpeg', Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)])))).rejects.toThrow(/5MB/);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rejects a file whose contents are not the type it claims', async () => {
      const { service, storage } = setup();
      await expect(asTenant(() => service.upload(PRODUCT, 'image/png', Buffer.from('<html>not an image</html>')))).rejects.toThrow(/not a valid/);
      await expect(asTenant(() => service.upload(PRODUCT, 'image/png', JPEG))).rejects.toThrow(/not a valid/);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('stops at 5 photos', async () => {
      const { service, storage } = setup(5);
      await expect(asTenant(() => service.upload(PRODUCT, 'image/jpeg', JPEG))).rejects.toThrow(/at most 5/);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('removes the stored file again if recording it fails', async () => {
      const { service, storage, tx } = setup();
      tx.productImage.create.mockRejectedValueOnce(new Error('db down'));
      await expect(asTenant(() => service.upload(PRODUCT, 'image/jpeg', JPEG))).rejects.toThrow('db down');
      expect(storage.deleteMany).toHaveBeenCalledWith([storage.upload.mock.calls[0][0]]);
    });
  });
});
