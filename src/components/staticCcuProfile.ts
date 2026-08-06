import {
    VideoRangeType,
    type CodecProfile,
    type DeviceProfile,
    type DirectPlayProfile,
    type ProfileCondition,
    type SubtitleProfile,
    type TranscodingProfile
} from '@jellyfin/sdk/lib/generated-client';
import { CodecType } from '@jellyfin/sdk/lib/generated-client/models/codec-type';
import { DlnaProfileType } from '@jellyfin/sdk/lib/generated-client/models/dlna-profile-type';
import { EncodingContext } from '@jellyfin/sdk/lib/generated-client/models/encoding-context';
import { ProfileConditionType } from '@jellyfin/sdk/lib/generated-client/models/profile-condition-type';
import { ProfileConditionValue } from '@jellyfin/sdk/lib/generated-client/models/profile-condition-value';
import { SubtitleDeliveryMethod } from '@jellyfin/sdk/lib/generated-client/models/subtitle-delivery-method';

/**
 * Static device profile for a single, frozen platform: the Chromecast Ultra (2016).
 *
 * Unlike the upstream receiver, this profile does NOT probe the device at runtime
 * with `canDisplayType()`. The CCU's firmware stopped receiving media updates years
 * ago, so its capabilities are a known constant. Advertising exactly those is
 * deterministic and immune to conservative/misreporting capability queries.
 *
 * Reference: Google Cast media support for Chromecast Ultra.
 *   - H.264  : High Profile, Level 4.2 (max 1080p)
 *   - HEVC   : Main / Main 10, Level 5.1 (max 4K60), HDR10
 *   - VP9    : Profile 0 / Profile 2 (max 4K)
 *   - Audio  : AAC-LC (stereo), AC3, EAC3, MP3, Opus, Vorbis, FLAC, WAV
 *   - Not    : AV1, DTS/DTS-HD, TrueHD, Dolby Vision, Matroska/MKV
 *
 * MKV is intentionally absent from the containers: the CCU has no Matroska
 * demuxer, so MKV files get server-side remuxed to MP4 (stream copy, no video
 * transcode). DTS/TrueHD/DV/AV1 are intentionally absent so the server
 * transcodes them instead of sending an unplayable stream.
 */

// Max level (as reported by the server, level * 10) for H.264 on CCU.
const H264_MAX_LEVEL = 42;
// Max level (as reported by the server, level * 3) for HEVC on CCU (5.1 -> 153).
const HEVC_MAX_LEVEL = 153;

/**
 * Create a new ProfileCondition.
 */
function createProfileCondition(
    property: ProfileConditionValue,
    condition: ProfileConditionType,
    value: string
): ProfileCondition {
    return {
        Condition: condition,
        Property: property,
        Value: value
    };
}

/**
 * Get direct play profiles.
 * @returns Direct play profiles.
 */
function getDirectPlayProfiles(): DirectPlayProfile[] {
    const directPlayProfiles: DirectPlayProfile[] = [];

    directPlayProfiles.push({
        AudioCodec: 'aac,ac3,eac3,mp3,opus',
        Container: 'mp4,m4v',
        Type: DlnaProfileType.Video,
        VideoCodec: 'h264,hevc,vp9'
    });

    directPlayProfiles.push({
        AudioCodec: 'vorbis,opus',
        Container: 'webm',
        Type: DlnaProfileType.Video,
        VideoCodec: 'vp8,vp9'
    });

    directPlayProfiles.push({
        AudioCodec: 'aac',
        Container: 'm4a',
        Type: DlnaProfileType.Audio
    });

    directPlayProfiles.push({
        AudioCodec: 'mp3',
        Container: 'mp3,mp4',
        Type: DlnaProfileType.Audio
    });

    directPlayProfiles.push({
        AudioCodec: 'opus,vorbis',
        Container: 'ogg,webm',
        Type: DlnaProfileType.Audio
    });

    directPlayProfiles.push({
        AudioCodec: 'flac',
        Container: 'flac',
        Type: DlnaProfileType.Audio
    });

    directPlayProfiles.push({
        AudioCodec: 'wav',
        Container: 'wav',
        Type: DlnaProfileType.Audio
    });

    return directPlayProfiles;
}

/**
 * Get codec profiles.
 * @returns Codec profiles.
 */
function getCodecProfiles(): CodecProfile[] {
    const codecProfiles: CodecProfile[] = [];

    const flacConditions: CodecProfile = {
        Codec: 'flac',
        Conditions: [
            createProfileCondition(
                ProfileConditionValue.AudioSampleRate,
                ProfileConditionType.LessThanEqual,
                '96000'
            ),
            createProfileCondition(
                ProfileConditionValue.AudioBitDepth,
                ProfileConditionType.LessThanEqual,
                '24'
            )
        ],
        Type: CodecType.Audio
    };

    codecProfiles.push(flacConditions);

    // AAC-LC is limited to stereo on Google Cast; the Cast SDK silently
    // downmixes (or mangles) anything above 2 channels. Let the server
    // transcode instead of the device guessing.
    // AC3/EAC3 are excluded here on purpose: the CCU decodes them natively
    // (up to 6ch), so they get no channel restriction and direct-play.
    const stereoCodecs = ['aac', 'mp3', 'opus', 'vorbis', 'wav'];

    for (const audioCodec of stereoCodecs) {
        const stereoConditions: ProfileCondition[] = [
            createProfileCondition(
                ProfileConditionValue.AudioChannels,
                ProfileConditionType.LessThanEqual,
                '2'
            )
        ];

        codecProfiles.push({
            Codec: audioCodec,
            Conditions: stereoConditions,
            Type: CodecType.Audio
        });

        codecProfiles.push({
            Codec: audioCodec,
            Conditions: stereoConditions,
            Type: CodecType.VideoAudio
        });
    }

    const h264Conditions: CodecProfile = {
        Codec: 'h264',
        Conditions: [
            createProfileCondition(
                ProfileConditionValue.IsAnamorphic,
                ProfileConditionType.NotEquals,
                'true'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoProfile,
                ProfileConditionType.EqualsAny,
                'constrained baseline|baseline|main|high'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoLevel,
                ProfileConditionType.LessThanEqual,
                H264_MAX_LEVEL.toString()
            ),
            createProfileCondition(
                ProfileConditionValue.VideoBitDepth,
                ProfileConditionType.GreaterThanEqual,
                '8'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoBitDepth,
                ProfileConditionType.LessThanEqual,
                '8'
            ),
            createProfileCondition(
                ProfileConditionValue.Width,
                ProfileConditionType.LessThanEqual,
                '1920'
            ),
            createProfileCondition(
                ProfileConditionValue.Height,
                ProfileConditionType.LessThanEqual,
                '1080'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoRangeType,
                ProfileConditionType.EqualsAny,
                `${VideoRangeType.Sdr}|${VideoRangeType.Hdr10}`
            )
        ],
        Type: CodecType.Video
    };

    codecProfiles.push(h264Conditions);

    // HEVC Main/Main10, up to Level 5.1 (4K60), 8/10-bit, SDR or HDR10.
    // HDR10 is explicitly allowed here - this is the case the upstream
    // receiver mishandles (it only probes Dolby Vision for HEVC).
    const hevcConditions: CodecProfile = {
        Codec: 'hevc',
        Conditions: [
            createProfileCondition(
                ProfileConditionValue.IsAnamorphic,
                ProfileConditionType.NotEquals,
                'true'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoProfile,
                ProfileConditionType.EqualsAny,
                'main|main10'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoLevel,
                ProfileConditionType.LessThanEqual,
                HEVC_MAX_LEVEL.toString()
            ),
            createProfileCondition(
                ProfileConditionValue.VideoBitDepth,
                ProfileConditionType.GreaterThanEqual,
                '8'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoBitDepth,
                ProfileConditionType.LessThanEqual,
                '10'
            ),
            createProfileCondition(
                ProfileConditionValue.Width,
                ProfileConditionType.LessThanEqual,
                '3840'
            ),
            createProfileCondition(
                ProfileConditionValue.Height,
                ProfileConditionType.LessThanEqual,
                '2160'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoRangeType,
                ProfileConditionType.EqualsAny,
                `${VideoRangeType.Sdr}|${VideoRangeType.Hdr10}`
            )
        ],
        Type: CodecType.Video
    };

    codecProfiles.push(hevcConditions);

    const vp9Conditions: CodecProfile = {
        Codec: 'vp9',
        Conditions: [
            createProfileCondition(
                ProfileConditionValue.IsAnamorphic,
                ProfileConditionType.NotEquals,
                'true'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoProfile,
                ProfileConditionType.EqualsAny,
                'Profile 0|Profile 2'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoBitDepth,
                ProfileConditionType.GreaterThanEqual,
                '8'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoBitDepth,
                ProfileConditionType.LessThanEqual,
                '10'
            ),
            createProfileCondition(
                ProfileConditionValue.Width,
                ProfileConditionType.LessThanEqual,
                '3840'
            ),
            createProfileCondition(
                ProfileConditionValue.Height,
                ProfileConditionType.LessThanEqual,
                '2160'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoRangeType,
                ProfileConditionType.EqualsAny,
                `${VideoRangeType.Sdr}|${VideoRangeType.Hdr10}`
            )
        ],
        Type: CodecType.Video
    };

    codecProfiles.push(vp9Conditions);

    const vp8Conditions: CodecProfile = {
        Codec: 'vp8',
        Conditions: [
            createProfileCondition(
                ProfileConditionValue.IsAnamorphic,
                ProfileConditionType.NotEquals,
                'true'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoBitDepth,
                ProfileConditionType.GreaterThanEqual,
                '8'
            ),
            createProfileCondition(
                ProfileConditionValue.VideoBitDepth,
                ProfileConditionType.LessThanEqual,
                '8'
            ),
            createProfileCondition(
                ProfileConditionValue.Width,
                ProfileConditionType.LessThanEqual,
                '3840'
            ),
            createProfileCondition(
                ProfileConditionValue.Height,
                ProfileConditionType.LessThanEqual,
                '2160'
            )
        ],
        Type: CodecType.Video
    };

    codecProfiles.push(vp8Conditions);

    const videoAudioConditions: CodecProfile = {
        Conditions: [
            createProfileCondition(
                ProfileConditionValue.IsSecondaryAudio,
                ProfileConditionType.Equals,
                'false'
            )
        ],
        Type: CodecType.VideoAudio
    };

    codecProfiles.push(videoAudioConditions);

    return codecProfiles;
}

/**
 * Get transcoding profiles.
 * @returns Transcoding profiles.
 */
function getTranscodingProfiles(): TranscodingProfile[] {
    const transcodingProfiles: TranscodingProfile[] = [];

    transcodingProfiles.push({
        AudioCodec: 'aac,mp3,opus',
        BreakOnNonKeyFrames: false,
        Container: 'ts',
        Context: EncodingContext.Streaming,
        MaxAudioChannels: '2',
        MinSegments: 1,
        Protocol: 'hls',
        Type: DlnaProfileType.Audio
    });

    const supportedAudio = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'wav'];

    for (const audioFormat of supportedAudio) {
        transcodingProfiles.push({
            AudioCodec: audioFormat,
            Container: audioFormat,
            Context: EncodingContext.Streaming,
            MaxAudioChannels: '2',
            Protocol: 'http',
            Type: DlnaProfileType.Audio
        });
    }

    // HLS with fMP4. AC3/EAC3 are deliberately absent: Google Cast chokes on
    // AC3/EAC3 delivered over HLS (the reason the upstream receiver hardcodes
    // them off), so anything that must transcode goes to stereo AAC.
    transcodingProfiles.push({
        AudioCodec: 'aac,mp3,opus',
        BreakOnNonKeyFrames: false,
        Container: 'mp4',
        Context: EncodingContext.Streaming,
        MaxAudioChannels: '2',
        MinSegments: 1,
        Protocol: 'hls',
        Type: DlnaProfileType.Video,
        VideoCodec: 'h264,hevc'
    });

    return transcodingProfiles;
}

/**
 * Get subtitle profiles.
 * @returns Subtitle profiles.
 */
function getSubtitleProfiles(): SubtitleProfile[] {
    return [
        {
            Format: 'vtt',
            Method: SubtitleDeliveryMethod.External
        },
        {
            Format: 'vtt',
            Method: SubtitleDeliveryMethod.Hls
        }
    ];
}

/**
 * Creates the static device profile for the Chromecast Ultra.
 * @param maxBitrate - maximum bitrate to be used by the server when streaming data
 * @returns Device profile.
 */
export function getDeviceProfile(maxBitrate: number): DeviceProfile {
    const profile: DeviceProfile = {
        MaxStaticBitrate: maxBitrate,
        MaxStreamingBitrate: maxBitrate,
        MusicStreamingTranscodingBitrate: Math.min(maxBitrate, 192000)
    };

    profile.DirectPlayProfiles = getDirectPlayProfiles();
    profile.TranscodingProfiles = getTranscodingProfiles();
    profile.CodecProfiles = getCodecProfiles();
    profile.SubtitleProfiles = getSubtitleProfiles();

    return profile;
}

export default getDeviceProfile;
