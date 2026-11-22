/** 歌单类型 */
export type MusicSheetType = 'user' | 'system';

/**
 * 歌曲精简信息（列表展示、播放队列）。
 *
 * 对应 `IMusic.IMusicItem` 的本地持久化精简版：
 * - IMusicItem：插件返回的完整歌曲数据（含 url / rawLrc / 任意扩展字段）
 * - IMusicItemSlim：列表展示字段，另外带上歌手和专辑编号，方便从歌单打开页面
 *
 * 完整原始数据通过 `music_items.raw` 列以 JSON 存储，按需读取。
 */
export interface IMusicItemSlim {
    platform: string;
    id: string;
    title: string;
    artist: string;
    album: string;
    duration: number | null;
    artwork: string | null;
    /** 当前平台上的歌手编号。收藏列表靠它打开歌手页。 */
    artistId?: string;
    /** 当前平台上的专辑编号。收藏列表靠它打开专辑页。 */
    albumId?: string;
    /** 内部标记：该对象为精简版，不含完整 raw 数据 */
    readonly $slim?: true;
}

/**
 * 本地歌单元数据（不含歌曲列表）。
 *
 * 与 `IMusic.IMusicSheetItem`（插件返回的远程歌单）的区别：
 * - IMusicSheetItem：插件侧的歌单结构，字段松散（含 musicList / playCount 等）
 * - ILocalSheetMeta：本地 SQLite 存储的歌单结构，字段严格固定
 */
export interface ILocalSheetMeta {
    id: string;
    title: string;
    artwork: string | null;
    description: string | null;
    type: MusicSheetType;
    folderPath: string | null;
    sortOrder: number;
    worksNum: number;
    createdAt: number;
    updatedAt: number;
    /** 歌单内最近加入的歌曲封面（仅当 artwork 为空时由 SQL 派生） */
    latestArtwork: string | null;
}

/** 歌单详情（含全量歌曲列表，slim 模式） */
export interface ILocalSheetDetail extends ILocalSheetMeta {
    musicList: IMusicItemSlim[];
}

/** 创建歌单参数 */
export interface ICreateSheetParams {
    title: string;
    artwork?: string;
    description?: string;
    type?: MusicSheetType;
    folderPath?: string;
}

/** 更新歌单参数（部分更新） */
export interface IUpdateSheetParams {
    id: string;
    title?: string;
    artwork?: string;
    description?: string;
    sortOrder?: number;
}

/** 星标远程歌单（本地存储） */
export interface IStarredSheetItem {
    platform: string;
    id: string;
    title: string | null;
    artwork: string | null;
    raw: string;
    sortOrder: number;
    starredAt: number;
}

/** 歌曲完整数据查询接口（解决 slim → full） */
export interface IMusicItemProvider {
    /** 根据 platform + id 查询完整 raw JSON，不存在时返回 null */
    getRawMusicItem(platform: string, id: string): IMusic.IMusicItem | null;
}
