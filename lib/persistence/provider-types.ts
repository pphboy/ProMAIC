import type {
  AssetStore,
  DocumentStore,
  DocumentFolderStore,
  RuntimeStore,
  SceneLike,
} from '@openmaic/storage';
import type { Scene, Stage } from '@openmaic/dsl';

/** Backend-neutral capabilities. Driver pools and transaction handles stay in each adapter. */
export interface PersistenceStores {
  runtimeStore: RuntimeStore;
  assetStore: AssetStore;
}
export type CourseDocumentStore<
  TScene extends SceneLike = Scene,
  TStage extends Stage = Stage,
> = DocumentStore<TScene, TStage> & DocumentFolderStore;
