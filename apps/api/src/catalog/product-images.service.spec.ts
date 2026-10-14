import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { ProductImagesService, productImagePrefix } from './product-images.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '22222222-2222-2222-2222-222222222222';
const PRODUCT = '33333333-3333-3333-3333-333333333333';
const FILE = '44444444-4444-4444-4444-444444444444.jpg';

function setup(imageCount = 0, head: { sizeBytes: number; contentType?: string } | null = { sizeBytes: 1000, contentType: 'image/jpeg' }) {
  const tx = {
    product: { findUnique: jest.fn().mockResolvedValue({ id: PRODUCT }) },
    productImage: {
      count: jest.fn().mockResolvedValue(imageCount),
      findMany: jest.fn().mockResolvedValue(Array.from({ length: imageCount }, (_, i) => ({ sortOrder: i }))),
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'img-1', ...create })),
    },
  };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const storage = {
    createUploadUrl: jest.fn().mockResolvedValue('https://upload.example/signed'),
    head: jest.fn().mockResolvedValue(head),
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
  describe('requestUpload', () => {
    it('signs an upload under this tenant and product', async () => {
      const { service, storage } = setup();
      const result = await asTenant(() => service.requestUpload(PRODUCT, { contentType: 'image/png', sizeBytes: 2000 }));
      expect(result.key.startsWith(productImagePrefix(ORG, PRODUCT))).toBe(true);
      expect(result.key.endsWith('.png')).toBe(true);
      expect(storage.createUploadUrl).toHaveBeenCalledWith(result.key, 'image/png', 2000);
    });

    it('rejects non-image types and oversized files', async () => {
      const { service } = setup();
      await expect(asTenant(() => service.requestUpload(PRODUCT, { contentType: 'application/pdf', sizeBytes: 10 }))).rejects.toThrow(BadRequestException);
      await expect(asTenant(() => service.requestUpload(PRODUCT, { contentType: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 }))).rejects.toThrow(/5MB/);
    });

    it('stops at 5 photos', async () => {
      const { service } = setup(5);
      await expect(asTenant(() => service.requestUpload(PRODUCT, { contentType: 'image/jpeg', sizeBytes: 10 }))).rejects.toThrow(/at most 5/);
    });
  });

  describe('confirm', () => {
    it('records an upload that landed correctly, after existing photos', async () => {
      const { service, tx } = setup(2);
      const key = productImagePrefix(ORG, PRODUCT) + FILE;
      const image = await asTenant(() => service.confirm(PRODUCT, { key }));
      expect(image).toEqual({ id: 'img-1', url: `https://cdn.example/${key}`, sortOrder: 2 });
      expect(tx.productImage.upsert).toHaveBeenCalled();
    });

    it("refuses another tenant's key", async () => {
      const { service, tx } = setup();
      const key = productImagePrefix(OTHER_ORG, PRODUCT) + FILE;
      await expect(asTenant(() => service.confirm(PRODUCT, { key }))).rejects.toThrow(/Invalid upload key/);
      expect(tx.productImage.upsert).not.toHaveBeenCalled();
    });

    it('refuses path tricks inside the prefix', async () => {
      const { service } = setup();
      const key = productImagePrefix(ORG, PRODUCT) + '../other/' + FILE;
      await expect(asTenant(() => service.confirm(PRODUCT, { key }))).rejects.toThrow(/Invalid upload key/);
    });

    it('rejects and deletes a file that is not really an image', async () => {
      const { service, storage, tx } = setup(0, { sizeBytes: 1000, contentType: 'text/html' });
      const key = productImagePrefix(ORG, PRODUCT) + FILE;
      await expect(asTenant(() => service.confirm(PRODUCT, { key }))).rejects.toThrow(BadRequestException);
      expect(storage.deleteMany).toHaveBeenCalledWith([key]);
      expect(tx.productImage.upsert).not.toHaveBeenCalled();
    });

    it('reports a missing upload', async () => {
      const { service } = setup(0, null);
      const key = productImagePrefix(ORG, PRODUCT) + FILE;
      await expect(asTenant(() => service.confirm(PRODUCT, { key }))).rejects.toThrow(/not found/);
    });
  });
});
