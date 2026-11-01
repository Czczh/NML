(function () {
  "use strict";

  var DEFAULTS = {
    enabled: true,
    nitroBadge: true,
    nitroTier: 2,
    boostBadge: true,
    boostMonths: 12,
    customAvatar: false,
    avatarUrl: "",
    customBanner: false,
    bannerUrl: "",
    customDecoration: false,
    decorationAsset: "",
    customColors: false,
    primaryColor: "#5865F2",
    secondaryColor: "#232428",
    customEffect: false,
    effectId: ""
  };
  var unpatches = [];
  var report = {};
  var storage = null;
  var isRunning = false;
  var ownId = null;

  function settings() {
    if (storage) return storage;
    try {
      storage = vendetta.plugin && vendetta.plugin.storage;
    } catch (_) {}
    if (!storage) storage = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      if (storage[key] === undefined) storage[key] = DEFAULTS[key];
    });
    return storage;
  }

  function config() {
    return settings();
  }

  function validUrl(value) {
    return typeof value === "string" && /^https:\/\/[^\s]+$/i.test(value.trim()) && value.length < 2049;
  }

  function validColor(value) {
    return typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value.trim());
  }

  function colorNumber(value) {
    return parseInt(value.slice(1), 16);
  }

  function targetId() {
    try {
      var users = vendetta.metro.common.UserStore;
      var me = users && users.getCurrentUser && users.getCurrentUser();
      if (me && me.id) return String(me.id);
    } catch (_) {}
    try {
      var module = vendetta.metro.findByProps("getCurrentUser", "getUser");
      var user = module && module.getCurrentUser();
      return user && user.id ? String(user.id) : null;
    } catch (_) {}
    return null;
  }

  function isMine(candidate) {
    var id = ownId;
    if (!id) return false;
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate) === id;
    if (candidate && typeof candidate === "object") {
      return String(candidate.id || candidate.userId || candidate.user_id || "") === id;
    }
    return false;
  }

  function cloneWith(source, extra) {
    if (!source || typeof source !== "object") return source;
    var result;
    try {
      result = Object.create(Object.getPrototypeOf(source));
      Object.defineProperties(result, Object.getOwnPropertyDescriptors(source));
      Object.keys(extra).forEach(function (key) {
        Object.defineProperty(result, key, {
          value: extra[key],
          enumerable: true,
          configurable: true,
          writable: true
        });
      });
      return result;
    } catch (_) {
      try { return Object.assign(Object.create(source), extra); } catch (__) { return source; }
    }
  }

  function decorateUser(user) {
    if (!isRunning || !config().enabled || !isMine(user)) return user;
    var opts = config();
    var changes = {};
    if (opts.customDecoration && typeof opts.decorationAsset === "string") {
      var asset = opts.decorationAsset.trim().replace(/^.*\/avatar-decoration-presets\//, "").replace(/\.(png|gif|webp).*$/i, "");
      if (/^[a-zA-Z0-9_\-]{6,150}$/.test(asset)) {
        changes.avatarDecorationData = { asset: asset, skuId: null };
        changes.avatar_decoration_data = { asset: asset, sku_id: null };
      }
    }
    return Object.keys(changes).length ? cloneWith(user, changes) : user;
  }

  function monthsDate(months) {
    var n = Math.max(1, Math.min(60, Number(months) || 1));
    var date = new Date();
    date.setUTCMonth(date.getUTCMonth() - n);
    return date.toISOString();
  }

  function decorateProfile(profile, userId) {
    if (!isRunning || !config().enabled || !profile || !isMine(userId || profile.userId || profile.user_id || (profile.user && profile.user.id))) return profile;
    var opts = config();
    var changes = {};
    if (opts.nitroBadge) {
      changes.premiumSince = "2023-01-01T00:00:00.000Z";
      changes.premium_since = "2023-01-01T00:00:00.000Z";
    }
    if (opts.boostBadge) {
      var since = monthsDate(opts.boostMonths);
      changes.premiumGuildSince = since;
      changes.premium_guild_since = since;
    }
    if (opts.customColors && validColor(opts.primaryColor) && validColor(opts.secondaryColor)) {
      var colors = [colorNumber(opts.primaryColor), colorNumber(opts.secondaryColor)];
      changes.themeColors = colors;
      changes.theme_colors = colors;
    }
    if (opts.customEffect && /^\d{10,25}$/.test(String(opts.effectId).trim())) {
      changes.profileEffectId = String(opts.effectId).trim();
      changes.profile_effect_id = changes.profileEffectId;
    }
    return Object.keys(changes).length ? cloneWith(profile, changes) : profile;
  }

  function installAfter(module, key, fn, name) {
    if (!module || typeof module[key] !== "function") return false;
    try {
      var undo = vendetta.patcher.after(key, module, function (args, ret) {
        try { return fn(args, ret); } catch (_) { return ret; }
      });
      if (typeof undo !== "function") return false;
      unpatches.push(undo);
      report[name] = "active";
      return true;
    } catch (e) {
      report[name] = "unsupported";
      return false;
    }
  }

  function findModule(names) {
    try {
      var module = vendetta.metro.findByProps.apply(null, names);
      if (module) return module;
    } catch (_) {}
    return null;
  }

  function tryPatch() {
    var users = null;
    try { users = vendetta.metro.common.UserStore; } catch (_) {}
    if (!users) users = findModule(["getUser", "getCurrentUser"]);
    if (users) {
      installAfter(users, "getUser", function (args, ret) { return decorateUser(ret); }, "avatar decoration");
      installAfter(users, "getCurrentUser", function (args, ret) { return decorateUser(ret); }, "own user");
    }

    var iconUtils = findModule(["getUserAvatarURL", "getGuildIconURL"]) || findModule(["getUserAvatarURL"]);
    if (iconUtils) {
      installAfter(iconUtils, "getUserAvatarURL", function (args, ret) {
        var opts = config();
        if (!opts.enabled || !opts.customAvatar || !validUrl(opts.avatarUrl) || !isMine(args[0])) return ret;
        return opts.avatarUrl.trim();
      }, "custom avatar");
      if (typeof iconUtils.getUserBannerURL === "function") {
        installAfter(iconUtils, "getUserBannerURL", function (args, ret) {
          var opts = config();
          if (!opts.enabled || !opts.customBanner || !validUrl(opts.bannerUrl) || !isMine(args[0])) return ret;
          return opts.bannerUrl.trim();
        }, "custom banner");
      }
    }
    var banners = findModule(["getUserBannerURL"]);
    if (banners && banners !== iconUtils) {
      installAfter(banners, "getUserBannerURL", function (args, ret) {
        var opts = config();
        if (!opts.enabled || !opts.customBanner || !validUrl(opts.bannerUrl) || !isMine(args[0])) return ret;
        return opts.bannerUrl.trim();
      }, "custom banner");
    }

    var profiles = findModule(["getUserProfile", "getMutualGuilds"]) || findModule(["getUserProfile"]);
    if (profiles) {
      installAfter(profiles, "getUserProfile", function (args, ret) {
        return decorateProfile(ret, args[0]);
      }, "profile effects, colors and badges");
    }
  }

  function pluginSettings() {
    var common = vendetta.metro.common;
    var React = common.React;
    var RN = common.ReactNative;
    var h = React.createElement;
    var s = settings();
    try { if (vendetta.storage && typeof vendetta.storage.useProxy === "function") vendetta.storage.useProxy(s); } catch (_) {}
    var state = React.useState(0);
    var refresh = state[1];

    function set(key, value) {
      s[key] = value;
      refresh(function (n) { return n + 1; });
    }

    function text(value, style) {
      return h(RN.Text, { style: Object.assign({ color: "#F2F3F5", fontSize: 14 }, style || {}) }, value);
    }

    function section(title, children) {
      return h(RN.View, { style: { marginTop: 21, gap: 9 } },
        text(title, { fontSize: 16, fontWeight: "700" }),
        children);
    }

    function toggle(label, key, description) {
      return h(RN.View, { key: key, style: { paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 10 } },
        h(RN.View, { style: { flex: 1 } }, text(label, { fontWeight: "600" }), text(description, { color: "#A8AAB2", fontSize: 12, marginTop: 3 })),
        h(RN.Switch, { value: !!s[key], onValueChange: function (value) { set(key, value); }, trackColor: { true: "#5865F2" } }));
    }

    function input(label, key, placeholder, maxLength) {
      return h(RN.View, { key: key, style: { gap: 5, marginTop: 6 } }, text(label, { fontSize: 12, color: "#B9BBC1" }),
        h(RN.TextInput, {
          value: String(s[key] === undefined ? "" : s[key]),
          onChangeText: function (value) { set(key, value); },
          placeholder: placeholder,
          placeholderTextColor: "#80848E",
          autoCapitalize: "none",
          maxLength: maxLength || 2048,
          style: { backgroundColor: "#1E1F22", color: "#FFFFFF", padding: 12, borderRadius: 7, borderWidth: 1, borderColor: "#3F4147", fontSize: 14 }
        }));
    }

    function tiers(key, options) {
      return h(RN.View, { style: { flexDirection: "row", flexWrap: "wrap", gap: 8 } },
        options.map(function (item) {
          var chosen = Number(s[key]) === item[0];
          return h(RN.Pressable, {
            key: String(item[0]), onPress: function () { set(key, item[0]); },
            style: { backgroundColor: chosen ? "#5865F2" : "#34363B", borderRadius: 5, paddingVertical: 9, paddingHorizontal: 13 }
          }, text(item[1], { fontWeight: chosen ? "700" : "400" }));
        }));
    }

    var badge = s.nitroBadge ? (Number(s.nitroTier) === 1 ? "Nitro Basic" : "Nitro") : "No Nitro badge";
    var header = h(RN.View, { style: { padding: 18, backgroundColor: "#26272C", borderRadius: 10, borderWidth: 1, borderColor: "#45464D", gap: 10 } },
      h(RN.View, { style: { height: 80, borderRadius: 5, backgroundColor: validColor(s.primaryColor) ? s.primaryColor : "#5865F2", overflow: "hidden" } },
        s.customBanner && validUrl(s.bannerUrl) ? h(RN.Image, { source: { uri: s.bannerUrl.trim() }, style: { width: "100%", height: 80 }, resizeMode: "cover" }) : null),
      h(RN.View, { style: { flexDirection: "row", alignItems: "center", gap: 13 } },
        s.customAvatar && validUrl(s.avatarUrl)
          ? h(RN.Image, { source: { uri: s.avatarUrl.trim() }, style: { width: 56, height: 56, borderRadius: 28 } })
          : h(RN.View, { style: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#5865F2", justifyContent: "center", alignItems: "center" } }, text("N", { fontWeight: "800", fontSize: 26 })),
        h(RN.View, { style: { flex: 1, gap: 4 } }, text("LOCAL PREVIEW", { fontWeight: "800", fontSize: 16 }), text(badge + (s.boostBadge ? "  |  Server Booster" : ""), { fontSize: 12, color: "#D9C5FF" }))));

    return h(RN.ScrollView, { style: { flex: 1, backgroundColor: "#121318" }, contentContainerStyle: { padding: 18, paddingBottom: 48 } },
      text("Nitro Mirage", { fontSize: 23, fontWeight: "800", marginBottom: 6 }),
      text("Only visual changes on this device. No messages, account edits, purchases or uploads.", { color: "#B9BBC1", fontSize: 12, marginBottom: 16 }),
      header,
      section("Master switch", toggle("Enable local appearance", "enabled", "Disabling restores the original look without removing settings.")),
      section("Local Nitro status", [
        toggle("Simulated Nitro badge", "nitroBadge", "Tries to show a Nitro badge on your own profile."),
        tiers("nitroTier", [[1, "Basic"], [2, "Nitro"]]),
        toggle("Simulated Server Boost badge", "boostBadge", "Your profile preview only."),
        text("Boost age", { fontSize: 12, color: "#B9BBC1" }),
        tiers("boostMonths", [[1, "1 month"], [3, "3 months"], [6, "6 months"], [12, "12 months"], [24, "24 months"]])
      ]),
      section("Animated or static images", [
        toggle("Use local custom avatar", "customAvatar", "An HTTPS image or GIF URL. Nothing is uploaded."),
        input("Avatar HTTPS URL", "avatarUrl", "https://example.com/avatar.gif"),
        toggle("Use local custom banner", "customBanner", "Displayed wherever the supported banner renderer is used."),
        input("Banner HTTPS URL", "bannerUrl", "https://example.com/banner.gif")
      ]),
      section("Decorations and profile", [
        toggle("Use avatar decoration", "customDecoration", "Discord decoration asset hash only."),
        input("Avatar decoration asset hash", "decorationAsset", "a_...", 150),
        toggle("Custom profile colors", "customColors", "Used in the profile renderer when supported."),
        input("Primary hex color", "primaryColor", "#5865F2", 7),
        input("Secondary hex color", "secondaryColor", "#232428", 7),
        toggle("Profile effect", "customEffect", "Only effects the app already recognizes can render."),
        input("Profile effect SKU ID", "effectId", "Discord effect SKU", 25)
      ]),
      section("Compatibility", [
        text(Object.keys(report).map(function (key) { return key + ": " + report[key]; }).join("\n") || "No compatible profile hooks detected", { fontSize: 12, color: "#B9BBC1" }),
        text("Unavailable components are skipped to reduce crash risk. Some profile elements may need reopening to refresh.", { fontSize: 12, color: "#B9BBC1" })
      ]),
      section("Not spoofed", text("Sending premium emojis, stickers, larger files, higher-quality Go Live streams, extra server boosts and account privileges still require genuine Discord Nitro.", { color: "#B9BBC1", fontSize: 12 })));
  }

  return {
    onLoad: function () {
      settings();
      report = {};
      isRunning = true;
      ownId = targetId();
      tryPatch();
      try { vendetta.logger.log("Nitro Mirage enabled. Local visual patches only."); } catch (_) {}
    },
    onUnload: function () {
      isRunning = false;
      while (unpatches.length) {
        try { unpatches.pop()(); } catch (_) {}
      }
      report = {};
      ownId = null;
    },
    settings: pluginSettings,
    setHookStatus: function (name, state) { report[name] = state; }
  };
})()
