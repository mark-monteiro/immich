import { AssetEntity, SystemConfig } from '@app/infra/entities';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { IAssetRepository } from '../asset/asset.repository';
import { APP_MEDIA_LOCATION } from '../domain.constant';
import { getLivePhotoMotionFilename } from '../domain.util';
import { IAssetJob } from '../job';
import { IStorageRepository } from '../storage/storage.repository';
import { INITIAL_SYSTEM_CONFIG, ISystemConfigRepository } from '../system-config';
import { IUserRepository } from '../user';
import { StorageTemplateCore } from './storage-template.core';

export interface MoveAssetMetadata {
  username: string | null;
  filename: string;
}

@Injectable()
export class StorageTemplateService {
  private logger = new Logger(StorageTemplateService.name);
  private core: StorageTemplateCore;

  constructor(
    @Inject(IAssetRepository) private assetRepository: IAssetRepository,
    @Inject(ISystemConfigRepository) configRepository: ISystemConfigRepository,
    @Inject(INITIAL_SYSTEM_CONFIG) config: SystemConfig,
    @Inject(IStorageRepository) private storageRepository: IStorageRepository,
    @Inject(IUserRepository) private userRepository: IUserRepository,
  ) {
    this.core = new StorageTemplateCore(configRepository, config, storageRepository);
  }

  async handleTemplateMigrationSingle(data: IAssetJob) {
    const { asset } = data;

    try {
      const user = await this.userRepository.get(asset.ownerId);
      const username = user?.username || null;
      const filename = asset.originalFileName || asset.id;
      await this.moveAsset(asset, { username, filename });

      // move motion part of live photo
      if (asset.livePhotoVideoId) {
        const [livePhotoVideo] = await this.assetRepository.getByIds([asset.livePhotoVideoId]);
        const motionFilename = getLivePhotoMotionFilename(filename, livePhotoVideo.originalPath);
        await this.moveAsset(livePhotoVideo, { username, filename: motionFilename });
      }
    } catch (error: any) {
      this.logger.error('Error running single template migration', error);
    }
  }

  async handleTemplateMigration() {
    try {
      console.time('migrating-time');
      const assets = await this.assetRepository.getAll();
      const users = await this.userRepository.getList();

      const livePhotoMap: Record<string, AssetEntity> = {};

      for (const asset of assets) {
        if (asset.livePhotoVideoId) {
          livePhotoMap[asset.livePhotoVideoId] = asset;
        }
      }

      for (const asset of assets) {
        const livePhotoParentAsset = livePhotoMap[asset.id];
        // TODO: remove livePhoto specific stuff once upload is fixed
        const user = users.find((user) => user.id === asset.ownerId);
        const username = user?.username || null;
        const filename = asset.originalFileName || livePhotoParentAsset?.originalFileName || asset.id;
        await this.moveAsset(asset, { username, filename });
      }

      this.logger.debug('Cleaning up empty directories...');
      await this.storageRepository.removeEmptyDirs(APP_MEDIA_LOCATION);
    } catch (error: any) {
      this.logger.error('Error running template migration', error);
    } finally {
      console.timeEnd('migrating-time');
    }
  }

  // TODO: use asset core (once in domain)
  async moveAsset(asset: AssetEntity, metadata: MoveAssetMetadata) {
    const destination = await this.core.getTemplatePath(asset, metadata);
    if (asset.originalPath !== destination) {
      const source = asset.originalPath;

      try {
        await this.storageRepository.moveFile(asset.originalPath, destination);
        try {
          await this.assetRepository.save({ id: asset.id, originalPath: destination });
          asset.originalPath = destination;
        } catch (error: any) {
          this.logger.warn('Unable to save new originalPath to database, undoing move', error?.stack);
          await this.storageRepository.moveFile(destination, source);
        }
      } catch (error: any) {
        this.logger.error(`Problem applying storage template`, error?.stack, { id: asset.id, source, destination });
      }
    }
    return asset;
  }
}
