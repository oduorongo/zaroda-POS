import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './common/prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  let queryRawMock: jest.Mock;

  beforeEach(async () => {
    queryRawMock = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: { $queryRaw: queryRawMock } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('reports ok', () => {
      expect(appController.getHealth()).toEqual({ status: 'ok' });
    });
  });

  describe('ready', () => {
    it('reports ok when the database is reachable', async () => {
      await expect(appController.getReady()).resolves.toEqual({ status: 'ok' });
    });

    it('reports unavailable when the database is not reachable', async () => {
      queryRawMock.mockRejectedValue(new Error('connection refused'));
      await expect(appController.getReady()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
