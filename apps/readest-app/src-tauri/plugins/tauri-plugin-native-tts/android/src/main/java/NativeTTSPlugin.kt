package com.readest.native_tts

import android.Manifest
import android.app.Activity
import android.content.Context
import android.util.Log
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.PluginResult
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.*
import java.net.URL

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import java.io.File

data class TTSVoiceData(
    val id: String,
    val name: String,
    val lang: String,
    val disabled: Boolean = false
)

@InvokeArg
class SpeakArgs(
    val text: String? = "",
    val preload: Boolean? = false
)

@InvokeArg
class SetRateArgs(
    val rate: Float? = 1.0f
)

@InvokeArg
class SetPitchArgs(
    val pitch: Float? = 1.0f
)

@InvokeArg
class SetVoiceArgs(
    val voice: String? = null
)

@InvokeArg
class UpdateMediaSessionMetadataArgs {
  var sessionId: String? = null
  var title: String? = null
  var artist: String? = null
  var album: String? = null
  var artwork: String? = null
}

@InvokeArg
class UpdateMediaSessionStateArgs {
  var sessionId: String? = null
  var playing: Boolean? = null
  var position: Int? = null // in milliseconds
  var duration: Int? = null // in milliseconds
}

@InvokeArg
class UpdateMediaLibraryArgs {
  var booksJson: String? = null
}

@InvokeArg
class SetMediaSessionActiveArgs {
  var active: Boolean? = null
  var sessionId: String? = null
  var ownsAudioFocus: Boolean? = null
  var notificationTitle: String? = null
  var notificationText: String? = null
  var foregroundServiceTitle: String? = null
  var foregroundServiceText: String? = null
  var bookHash: String? = null
  var bookTitle: String? = null
  var bookAuthor: String? = null
}

@InvokeArg
class PlayoutControlArgs {
    var action: String? = null
    var rate: Double? = null
    var path: String? = null
    var positionMs: Double? = null
    // Byte window [start, end) of `path` to play as the whole track.
    var start: Long? = null
    var end: Long? = null
}

@TauriPlugin(
  permissions = [
    Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "postNotification")
  ]
)
class NativeTTSPlugin(private val activity: Activity) : Plugin(activity) {
    
    companion object {
        private const val TAG = "NativeTTSPlugin"
        var NOTIFICATION_TITLE = "Read Aloud"
        var NOTIFICATION_TEXT = "Ready to read aloud"
        var FOREGROUND_SERVICE_TITLE = "Read Aloud"
        var FOREGROUND_SERVICE_TEXT = "Ready to read aloud"
    }

    // The TextToSpeech engine and the sentence queue live in
    // MediaPlaybackService (application context, foreground service), so
    // speech survives the WebView stalling and the Activity being destroyed.
    // This plugin only routes commands to it and relays its utterance events
    // to the WebView via the trigger set by set_media_session_active.
    private val coroutineScope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // Continuous local-file playback for EPUB Media Overlays and paired
    // audiobooks. The WebView cannot expose Android app-private files as a
    // seekable Blob without first reading the whole file into memory; ExoPlayer
    // can seek and stream the original file path directly.
    private var playoutPlayer: ExoPlayer? = null
    private var playoutSession = 0
    private var playoutCurrentIndex = -1
    private var playoutRate = 1.0f
    private var playoutLoadedPath: String? = null
    private val playoutListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_ENDED && playoutCurrentIndex >= 0) {
                playoutCurrentIndex = -1
                emitPlayoutEvent("ended", 0)
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            // The failed item can't play again by seeking; the next load of the
            // same file must prepare it afresh.
            playoutLoadedPath = null
            if (playoutCurrentIndex < 0) return
            Log.e(TAG, "Native narration playback failed", error)
            playoutCurrentIndex = -1
            emitPlayoutEvent("error", 0)
        }
    }

    @Command
    fun init(invoke: Invoke) {
        coroutineScope.launch {
            try {
                // The engine lives in the service; start it (plain
                // startService, allowed while the app is foregrounded) and
                // wait until it reports ready, so init only resolves success
                // once voices actually exist.
                var ready = false
                for (i in 0 until 30) {
                    MediaPlaybackService.ensureService(activity)
                    MediaPlaybackService.ensureLive()
                    if (MediaPlaybackService.isLiveTtsReady()) {
                        ready = true
                        break
                    }
                    delay(100)
                }
                invoke.resolve(JSObject().apply { put("success", ready) })
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize TTS", e)
                invoke.reject("Failed to initialize TTS: ${e.message}")
            }
        }
    }

    @Command
    fun speak(invoke: Invoke) {
        val args = invoke.parseArgs(SpeakArgs::class.java)
        val text = args.text ?: ""

        if (text.isEmpty()) {
            invoke.reject("Text cannot be empty")
            return
        }

        val utteranceId = UUID.randomUUID().toString()

        try {
            // Utterance events now come back from the service over the
            // tts_events channel (its pluginEventTrigger, set by
            // set_media_session_active); the plugin no longer owns an engine
            // or an event channel of its own.
            MediaPlaybackService.ensureService(activity)
            MediaPlaybackService.ensureLive()
            if (args.preload == true) {
                MediaPlaybackService.enqueueLive(utteranceId, text)
            } else {
                MediaPlaybackService.speakLiveNow(utteranceId, text)
            }
            invoke.resolve(JSObject().apply { put("utteranceId", utteranceId) })
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start speaking", e)
            invoke.reject("Failed to start speaking: ${e.message}")
        }
    }

    @Command
    fun pause(invoke: Invoke) {
        try {
            MediaPlaybackService.pauseLive()
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Exception while pausing: ${e.message}")
        }
    }

    @Command
    fun resume(invoke: Invoke) {
        // Deliberately a no-op, as before: the WebView resume re-speaks the
        // current sentence itself. Routing resume to the service too would
        // speak it twice. The service's own resume runs only from its own
        // transports (lock-screen play, audio-focus gain) for the
        // frozen-WebView case.
        try {
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Exception while resuming: ${e.message}")
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        try {
            MediaPlaybackService.stopLive()
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Exception while stopping: ${e.message}")
        }
    }

    @Command
    fun set_rate(invoke: Invoke) {
        val args = invoke.parseArgs(SetRateArgs::class.java)
        try {
            MediaPlaybackService.setLiveRate(args.rate ?: 1.0f)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Exception setting rate: ${e.message}")
        }
    }

    @Command
    fun set_pitch(invoke: Invoke) {
        val args = invoke.parseArgs(SetPitchArgs::class.java)
        try {
            MediaPlaybackService.setLivePitch(args.pitch ?: 1.0f)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Exception setting pitch: ${e.message}")
        }
    }

    @Command
    fun set_voice(invoke: Invoke) {
        val args = invoke.parseArgs(SetVoiceArgs::class.java)
        coroutineScope.launch {
            try {
                val target = args.voice
                val voices = MediaPlaybackService.getLiveVoices()
                val found = target?.let { name ->
                    voices.any { voice ->
                        val languageTag = voice.locale.toLanguageTag()
                        voice.name == name || (languageTag.contains(voice.name) && languageTag == name)
                    }
                } ?: false
                if (found) {
                    MediaPlaybackService.setLiveVoice(target)
                    invoke.resolve()
                } else {
                    invoke.reject("Voice not found: $target")
                }
            } catch (e: Exception) {
                invoke.reject("Exception setting voice: ${e.message}")
            }
        }
    }

    @Command
    fun get_all_voices(invoke: Invoke) {
        coroutineScope.launch {
            try {
                MediaPlaybackService.ensureService(activity)
                // The service starts asynchronously: ensureLive is a no-op
                // until the instance exists, so wait for it first or the
                // readiness wait below expires before the service is there.
                for (i in 0 until 20) {
                    if (MediaPlaybackService.hasInstance()) break
                    delay(100)
                }
                MediaPlaybackService.ensureLive()
                // Voices only exist once the service engine is ready; wait
                // briefly rather than returning an empty list.
                for (i in 0 until 20) {
                    if (MediaPlaybackService.isLiveTtsReady()) break
                    delay(100)
                }
                val voices = MediaPlaybackService.getLiveVoices().map { voice ->
                    val voiceName = voice.name
                    val language = voice.locale.toLanguageTag()
                    val (id, name) = if (language.contains(voiceName)) {
                        language to language
                    } else {
                        voiceName to voiceName
                    }
                    JSObject().apply {
                        put("id", id)
                        put("name", name)
                        put("lang", language)
                        put("disabled", false)
                    }
                }

                val result = JSObject().apply {
                    put("voices", JSONArray(voices))
                }
                invoke.resolve(result)
            } catch (e: Exception) {
                invoke.reject("Exception getting voices: ${e.message}")
            }
        }
    }

    // Open the phone's Text-to-speech settings. An intent: URL navigated
    // to from the WebView lands on a "Web page not available" error, so
    // the settings panel calls this command instead.
    @Command
    fun open_tts_settings(invoke: Invoke) {
        try {
            // The action string, not Settings.ACTION_TTS_SETTINGS: that
            // constant is @hide in AOSP and absent from the public SDK,
            // so the reference does not compile even with compileSdk 36.
            val intent = Intent("com.android.settings.TTS_SETTINGS")
            activity.startActivity(intent)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Could not open TTS settings: ${e.message}")
        }
    }

    private suspend fun loadArtworkFromUrl(urlString: String): Bitmap? {
        return withContext(Dispatchers.IO) {
            try {
                when {
                    urlString.startsWith("data:image/") -> {
                        val base64Data = urlString.substringAfter("base64,")
                        val decodedBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
                        BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
                    }
                    urlString.startsWith("http") -> {
                        val url = URL(urlString)
                        val input: java.io.InputStream = url.openStream()
                        BitmapFactory.decodeStream(input)
                    }
                    else -> {
                        val assetPath = urlString.removePrefix("/")
                        val inputStream = activity.assets.open(assetPath)
                        BitmapFactory.decodeStream(inputStream)
                    }
                }
            } catch (e: Exception) {
                null
            }
        }
    }

    @Command
    fun update_media_session_metadata(invoke: Invoke) {
        val args = invoke.parseArgs(UpdateMediaSessionMetadataArgs::class.java)
        val title = args.title ?: ""
        val artist = args.artist ?: ""

        coroutineScope.launch {
            try {
                val artworkBitmap = args.artwork?.let { loadArtworkFromUrl(it) }
                // In-process update on the running service; never startService()
                // — that throws "app is in background" once backgrounded.
                MediaPlaybackService.pushMetadata(args.sessionId, title, artist, artworkBitmap)
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject("Failed to update metadata: ${e.message}")
            }
        }
    }

    @Command
    fun update_media_session_state(invoke: Invoke) {
        val args = invoke.parseArgs(UpdateMediaSessionStateArgs::class.java)
        val isPlaying = args.playing ?: false

        try {
            // In-process update on the running service; never startService()
            // — that throws "app is in background" once backgrounded. position
            // and duration are null on a bare play/pause flip; the service
            // keeps the last known values so the scrubber does not reset.
            MediaPlaybackService.pushPlaybackState(
                args.sessionId,
                isPlaying,
                args.position?.toLong(),
                args.duration?.toLong(),
            )
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Failed to update playback state: ${e.message}")
        }
    }

    @Command
    fun update_media_library(invoke: Invoke) {
        val args = invoke.parseArgs(UpdateMediaLibraryArgs::class.java)
        try {
            MediaPlaybackService.saveLibrary(activity, args.booksJson ?: "[]")
            // Keep a process-local route from Android Auto selections back to
            // the WebView even while no TTS session is active.
            MediaPlaybackService.setPluginEventTrigger { event, data -> trigger(event, data) }
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Failed to update Android Auto library: ${e.message}")
        }
    }

    @Command
    fun set_media_session_active(invoke: Invoke) {
        var args = invoke.parseArgs(SetMediaSessionActiveArgs::class.java)
        val active = args.active ?: true

        args.notificationTitle?.let { NOTIFICATION_TITLE = it }
        args.notificationText?.let { NOTIFICATION_TEXT = it }
        args.foregroundServiceTitle?.let { FOREGROUND_SERVICE_TITLE = it }
        args.foregroundServiceText?.let { FOREGROUND_SERVICE_TEXT = it }

        try {
            if (active) {
                MediaPlaybackService.currentTitle = FOREGROUND_SERVICE_TITLE
                MediaPlaybackService.currentArtist = FOREGROUND_SERVICE_TEXT
                // Set before the service starts: activateSession reads it to
                // decide whether to take audio focus for this session.
                MediaPlaybackService.ownsAudioFocus = args.ownsAudioFocus ?: true
                // Record ownership before service creation. A late teardown
                // from the prior book must not deactivate this replacement.
                MediaPlaybackService.requestActivation(args.sessionId, args.bookHash)
                MediaPlaybackService.setPluginEventTrigger { event, data -> trigger(event, data) }
                // Persist the book so the Android Auto browse tree can offer a
                // "Resume last book" entry after the process is cold.
                args.bookHash?.let {
                    MediaPlaybackService.saveLastBook(activity, it, args.bookTitle, args.bookAuthor)
                }
                val intent = Intent(activity, MediaPlaybackService::class.java).apply {
                    action = MediaPlaybackService.ACTION_ACTIVATE_SESSION
                }
                Log.d(TAG, "set_media_session_active: startForegroundService")
                ContextCompat.startForegroundService(activity, intent)
            } else {
                // Not stopService: Android Auto may keep the service bound for
                // browsing, in which case stopService would leave the foreground
                // notification and the keep-alive player running.
                MediaPlaybackService.requestDeactivation(args.sessionId)
            }
            invoke.resolve()
        } catch (e: Exception) {
            if (active) {
                MediaPlaybackService.requestDeactivation(args.sessionId)
            }
            invoke.reject("Failed to set media session active state: ${e.message}")
        }
    }

    @Command
    fun playout_control(invoke: Invoke) {
        val args = invoke.parseArgs(PlayoutControlArgs::class.java)
        val action = args.action ?: ""

        activity.runOnUiThread {
            try {
                when (action) {
                    "start-session" -> {
                        abortPlayout()
                        playoutSession += 1
                        invoke.resolve(JSObject().apply { put("session", playoutSession) })
                    }
                    "end-session" -> {
                        if (playoutCurrentIndex < 0) emitPlayoutEvent("session-end")
                        invoke.resolve(JSObject().apply { put("session", JSONObject.NULL) })
                    }
                    "abort" -> {
                        abortPlayout()
                        invoke.resolve(JSObject().apply { put("session", JSONObject.NULL) })
                    }
                    "pause" -> {
                        playoutPlayer?.pause()
                        invoke.resolve(JSObject().apply { put("session", JSONObject.NULL) })
                    }
                    "resume" -> {
                        playoutPlayer?.play()
                        invoke.resolve(JSObject().apply { put("session", JSONObject.NULL) })
                    }
                    "set-rate" -> {
                        playoutRate = (args.rate ?: 1.0).toFloat()
                        playoutPlayer?.setPlaybackSpeed(playoutRate)
                        invoke.resolve(JSObject().apply { put("session", JSONObject.NULL) })
                    }
                    "load" -> {
                        val path = args.path
                        if (path.isNullOrEmpty()) {
                            invoke.reject("playout load requires path")
                        } else {
                            loadContinuousFile(path, args.positionMs ?: 0.0, args.start, args.end)
                            invoke.resolve(JSObject().apply { put("session", playoutSession) })
                        }
                    }
                    "seek" -> {
                        playoutPlayer?.seekTo((args.positionMs ?: 0.0).coerceAtLeast(0.0).toLong())
                        invoke.resolve(JSObject().apply { put("session", JSONObject.NULL) })
                    }
                    else -> invoke.reject("Unknown playout action: $action")
                }
            } catch (e: Exception) {
                invoke.reject("Native narration control failed: ${e.message}")
            }
        }
    }

    @Command
    fun playout_position(invoke: Invoke) {
        activity.runOnUiThread {
            val player = playoutPlayer
            invoke.resolve(JSObject().apply {
                put("session", playoutSession)
                put("index", playoutCurrentIndex)
                put("positionMs", player?.currentPosition ?: 0L)
                put("playing", player?.isPlaying ?: false)
            })
        }
    }

    private fun ensurePlayoutPlayer(): ExoPlayer {
        return playoutPlayer ?: ExoPlayer.Builder(activity).build().also { player ->
            player.addListener(playoutListener)
            player.setPlaybackSpeed(playoutRate)
            playoutPlayer = player
        }
    }

    @androidx.annotation.OptIn(UnstableApi::class)
    private fun loadContinuousFile(path: String, positionMs: Double, start: Long?, end: Long?) {
        // A paired Audiobookshelf audiobook streams its tracks by URL, the
        // same way the iOS playout player already accepts http(s) paths.
        val uri = if (path.startsWith("http://") || path.startsWith("https://")) {
            Uri.parse(path)
        } else {
            val file = File(path)
            require(file.isFile) { "Narration file not found: $path" }
            Uri.fromFile(file)
        }
        val player = ensurePlayoutPlayer()
        val startMs = positionMs.coerceAtLeast(0.0).toLong()
        // One book file holds many audio entries, so the window is part of
        // what is loaded.
        val window = if (start != null && end != null) start to end else null
        val loadedKey = window?.let { "$path#${it.first}-${it.second}" } ?: path

        if (playoutLoadedPath == loadedKey && player.currentMediaItem != null) {
            player.seekTo(startMs)
        } else {
            if (window != null) {
                // A stored audio entry inside the book's zip: stream its bytes
                // in place rather than copying them out.
                val (from, to) = window
                require(to > from) { "Empty narration window: $from-$to" }
                val file = File(path)
                val factory = DataSource.Factory { FileWindowDataSource(file, from, to - from) }
                val source = ProgressiveMediaSource.Factory(factory)
                    .createMediaSource(MediaItem.fromUri(uri))
                player.setMediaSource(source, startMs)
            } else {
                player.setMediaItem(MediaItem.fromUri(uri), startMs)
            }
            player.prepare()
            playoutLoadedPath = loadedKey
        }
        // Loading and resuming are separate operations, matching the web and
        // iOS clocks used by MediaOverlayClient.
        player.pause()
        playoutCurrentIndex = 0
        emitPlayoutEvent("chunk-start", 0)
    }

    private fun abortPlayout() {
        playoutCurrentIndex = -1
        playoutPlayer?.stop()
        playoutPlayer?.clearMediaItems()
        playoutLoadedPath = null
    }

    private fun emitPlayoutEvent(type: String, index: Int? = null) {
        trigger("playout_events", JSObject().apply {
            put("type", type)
            put("session", playoutSession)
            index?.let { put("index", it) }
        })
    }
    
    fun destroy() {
        try {
            // The live engine lives in the service, not the plugin: it keeps
            // speaking after the Activity is gone. Deactivation stops the
            // session (and its speech) when the plugin itself is torn down,
            // matching the old destroy() behaviour.
            MediaPlaybackService.requestDeactivation()
            MediaPlaybackService.setPluginEventTrigger(null)

            coroutineScope.cancel()
            playoutPlayer?.release()
            playoutPlayer = null

            Log.d(TAG, "Plugin destroyed successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Error during plugin destruction", e)
        }
    }
}
