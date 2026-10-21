/* ═════════════════════════════════════════════════════════════════════════
   Emoji catalog for the PDF → Markdown editor picker.
   ──────────────────────────────────────────────────────────────────────────
   Curated, zero-dependency set (~260 emojis) with keywords for search + a
   `:shortcode:` map that matches GitHub / Slack conventions and the
   backend `EMOJI_SHORTCODES` in pdf_to_markdown.py.

   Data shape is deliberately compact so the entire file gzips to <8 KB.
   ═════════════════════════════════════════════════════════════════════════ */

export interface EmojiEntry {
  /** The rendered emoji character. */
  e: string
  /** Primary shortcode (used as `:name:`). */
  n: string
  /** Optional alternate keywords for search (space separated). */
  k?: string
}

export interface EmojiCategory {
  id: string
  label: string
  icon: string
  items: EmojiEntry[]
}

/* ── Categories (curated for developer / documentation use cases) ── */
export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    items: [
      { e: '😀', n: 'grinning', k: 'happy smile face' },
      { e: '😃', n: 'smiley', k: 'happy joy' },
      { e: '😄', n: 'smile', k: 'happy joy laugh' },
      { e: '😁', n: 'grin', k: 'happy smile' },
      { e: '😆', n: 'laughing', k: 'lol laugh haha' },
      { e: '😅', n: 'sweat_smile', k: 'nervous relief' },
      { e: '🤣', n: 'rofl', k: 'lol laugh floor' },
      { e: '😂', n: 'joy', k: 'lol laugh tears' },
      { e: '🙂', n: 'slight_smile', k: 'smile' },
      { e: '🙃', n: 'upside_down', k: 'silly' },
      { e: '😉', n: 'wink', k: 'flirt' },
      { e: '😊', n: 'smile', k: 'blush happy' },
      { e: '😇', n: 'innocent', k: 'angel halo' },
      { e: '🥰', n: 'smiling_hearts', k: 'love adore' },
      { e: '😍', n: 'heart_eyes', k: 'love adore' },
      { e: '🤩', n: 'star_struck', k: 'excited wow' },
      { e: '😘', n: 'kiss', k: 'love' },
      { e: '😗', n: 'kissing', k: 'kiss' },
      { e: '😌', n: 'relieved', k: 'calm relax' },
      { e: '😔', n: 'pensive', k: 'sad think' },
      { e: '😪', n: 'sleepy', k: 'tired' },
      { e: '🤤', n: 'drooling', k: 'yum food' },
      { e: '😴', n: 'sleeping', k: 'sleep zzz' },
      { e: '😷', n: 'mask', k: 'sick medical' },
      { e: '🤒', n: 'thermometer', k: 'sick fever' },
      { e: '🤕', n: 'head_bandage', k: 'hurt injury' },
      { e: '🤧', n: 'sneeze', k: 'sick tissue' },
      { e: '🥵', n: 'hot', k: 'sweat heat' },
      { e: '🥶', n: 'cold', k: 'freezing' },
      { e: '🤯', n: 'exploding_head', k: 'mind blown wow' },
      { e: '🤠', n: 'cowboy', k: 'hat' },
      { e: '🥳', n: 'partying', k: 'party celebrate' },
      { e: '😎', n: 'sunglasses', k: 'cool' },
      { e: '🤓', n: 'nerd', k: 'geek smart' },
      { e: '🧐', n: 'monocle', k: 'inspect examine' },
      { e: '😕', n: 'confused', k: 'unsure' },
      { e: '😟', n: 'worried', k: 'concern' },
      { e: '🙁', n: 'frown', k: 'sad' },
      { e: '☹️', n: 'sad', k: 'frown' },
      { e: '😮', n: 'open_mouth', k: 'surprised' },
      { e: '😯', n: 'hushed', k: 'quiet shhh' },
      { e: '😲', n: 'astonished', k: 'shock' },
      { e: '😳', n: 'flushed', k: 'embarrass' },
      { e: '🥺', n: 'pleading', k: 'please beg' },
      { e: '😦', n: 'frowning', k: 'sad' },
      { e: '😧', n: 'anguished', k: 'suffer' },
      { e: '😨', n: 'fearful', k: 'scared' },
      { e: '😰', n: 'anxious', k: 'nervous sweat' },
      { e: '😥', n: 'sad_relieved', k: 'phew' },
      { e: '😢', n: 'cry', k: 'sad tear' },
      { e: '😭', n: 'sob', k: 'cry sad' },
      { e: '😱', n: 'scream', k: 'shock fear' },
      { e: '🤬', n: 'cursing', k: 'angry mad swear' },
      { e: '😡', n: 'rage', k: 'angry mad' },
      { e: '😠', n: 'angry', k: 'mad' },
      { e: '🤢', n: 'nauseated', k: 'sick puke' },
      { e: '🤮', n: 'vomit', k: 'sick puke' },
      { e: '🥴', n: 'woozy', k: 'drunk dizzy' },
      { e: '😵', n: 'dizzy', k: 'faint spinning' },
      { e: '🤖', n: 'robot', k: 'bot ai' },
      { e: '👻', n: 'ghost', k: 'halloween spooky' },
      { e: '💀', n: 'skull', k: 'death dead' },
      { e: '👽', n: 'alien', k: 'ufo space' },
      { e: '💩', n: 'poop', k: 'shit crap' },
      { e: '🎃', n: 'jack_o_lantern', k: 'halloween pumpkin' },
    ],
  },
  {
    id: 'gestures',
    label: 'People',
    icon: '👍',
    items: [
      { e: '👍', n: 'thumbsup', k: 'like approve yes ok' },
      { e: '👎', n: 'thumbsdown', k: 'dislike no' },
      { e: '👌', n: 'ok_hand', k: 'ok perfect' },
      { e: '🤌', n: 'pinched', k: 'italian' },
      { e: '🤏', n: 'pinch', k: 'small' },
      { e: '✌️', n: 'peace', k: 'victory' },
      { e: '🤞', n: 'crossed_fingers', k: 'hope luck' },
      { e: '🫰', n: 'money_fingers', k: 'money' },
      { e: '🤟', n: 'love_you', k: 'rock' },
      { e: '🤘', n: 'metal', k: 'rock horns' },
      { e: '🤙', n: 'call_me', k: 'shaka phone' },
      { e: '👈', n: 'point_left', k: 'left' },
      { e: '👉', n: 'point_right', k: 'right' },
      { e: '👆', n: 'point_up', k: 'up' },
      { e: '👇', n: 'point_down', k: 'down' },
      { e: '☝️', n: 'index_pointing_up', k: 'one first' },
      { e: '✋', n: 'raised_hand', k: 'stop high five' },
      { e: '🤚', n: 'raised_back_hand', k: 'stop' },
      { e: '🖐️', n: 'hand_splayed', k: 'stop five' },
      { e: '🖖', n: 'vulcan', k: 'spock live long' },
      { e: '👋', n: 'wave', k: 'hi hello bye' },
      { e: '🤝', n: 'handshake', k: 'agreement deal' },
      { e: '🙌', n: 'raised_hands', k: 'celebration hooray' },
      { e: '👏', n: 'clap', k: 'applause bravo' },
      { e: '🙏', n: 'pray', k: 'please thanks amen' },
      { e: '✍️', n: 'writing', k: 'write pen author' },
      { e: '💪', n: 'muscle', k: 'strong flex' },
      { e: '🦾', n: 'prosthetic_arm', k: 'strong tech' },
      { e: '👶', n: 'baby', k: 'child' },
      { e: '🧒', n: 'child', k: 'kid' },
      { e: '👦', n: 'boy', k: 'child male' },
      { e: '👧', n: 'girl', k: 'child female' },
      { e: '🧑', n: 'person', k: 'adult' },
      { e: '👨', n: 'man', k: 'male adult' },
      { e: '👩', n: 'woman', k: 'female adult' },
      { e: '🧓', n: 'older_person', k: 'old adult' },
      { e: '👴', n: 'old_man', k: 'grandpa' },
      { e: '👵', n: 'old_woman', k: 'grandma' },
      { e: '👨‍💻', n: 'man_technologist', k: 'developer engineer coder' },
      { e: '👩‍💻', n: 'woman_technologist', k: 'developer engineer coder' },
      { e: '🧑‍💻', n: 'technologist', k: 'developer engineer coder' },
      { e: '👨‍🎨', n: 'man_artist', k: 'painter designer' },
      { e: '👩‍🎨', n: 'woman_artist', k: 'painter designer' },
      { e: '👨‍🏫', n: 'man_teacher', k: 'professor educator' },
      { e: '👩‍🏫', n: 'woman_teacher', k: 'professor educator' },
      { e: '👮', n: 'police', k: 'cop officer' },
      { e: '🕵️', n: 'detective', k: 'spy investigator' },
      { e: '🥷', n: 'ninja', k: 'shinobi' },
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    icon: '🌿',
    items: [
      { e: '🐶', n: 'dog', k: 'pet puppy' },
      { e: '🐱', n: 'cat', k: 'pet kitten' },
      { e: '🐭', n: 'mouse', k: 'rodent' },
      { e: '🐹', n: 'hamster', k: 'pet' },
      { e: '🐰', n: 'rabbit', k: 'bunny' },
      { e: '🦊', n: 'fox', k: 'animal' },
      { e: '🐻', n: 'bear', k: 'animal' },
      { e: '🐼', n: 'panda', k: 'animal bear' },
      { e: '🐨', n: 'koala', k: 'australia' },
      { e: '🐯', n: 'tiger', k: 'animal cat' },
      { e: '🦁', n: 'lion', k: 'animal cat' },
      { e: '🐮', n: 'cow', k: 'animal' },
      { e: '🐷', n: 'pig', k: 'animal' },
      { e: '🐸', n: 'frog', k: 'animal' },
      { e: '🐵', n: 'monkey', k: 'animal ape' },
      { e: '🙈', n: 'see_no_evil', k: 'monkey' },
      { e: '🙉', n: 'hear_no_evil', k: 'monkey' },
      { e: '🙊', n: 'speak_no_evil', k: 'monkey' },
      { e: '🐔', n: 'chicken', k: 'bird animal' },
      { e: '🐧', n: 'penguin', k: 'bird animal' },
      { e: '🐦', n: 'bird', k: 'animal' },
      { e: '🦆', n: 'duck', k: 'bird animal' },
      { e: '🦅', n: 'eagle', k: 'bird animal' },
      { e: '🦉', n: 'owl', k: 'bird animal' },
      { e: '🦇', n: 'bat', k: 'animal' },
      { e: '🐺', n: 'wolf', k: 'animal' },
      { e: '🐝', n: 'bee', k: 'insect' },
      { e: '🐛', n: 'bug', k: 'insect worm' },
      { e: '🦋', n: 'butterfly', k: 'insect' },
      { e: '🐌', n: 'snail', k: 'slow animal' },
      { e: '🐞', n: 'ladybug', k: 'insect' },
      { e: '🌸', n: 'cherry_blossom', k: 'flower spring' },
      { e: '🌹', n: 'rose', k: 'flower love' },
      { e: '🌷', n: 'tulip', k: 'flower' },
      { e: '🌻', n: 'sunflower', k: 'flower' },
      { e: '🌵', n: 'cactus', k: 'plant desert' },
      { e: '🌲', n: 'evergreen', k: 'tree' },
      { e: '🌳', n: 'tree', k: 'plant' },
      { e: '🌴', n: 'palm_tree', k: 'tropical' },
      { e: '🌱', n: 'seedling', k: 'plant new grow' },
      { e: '🌿', n: 'herb', k: 'leaf plant' },
      { e: '☘️', n: 'shamrock', k: 'irish clover' },
      { e: '🍀', n: 'four_leaf_clover', k: 'luck' },
      { e: '🍁', n: 'maple_leaf', k: 'canada autumn' },
      { e: '🍂', n: 'fallen_leaf', k: 'autumn' },
      { e: '⭐', n: 'star', k: 'favorite highlight' },
      { e: '🌟', n: 'sparkle_star', k: 'shine special' },
      { e: '✨', n: 'sparkles', k: 'magic shine special' },
      { e: '⚡', n: 'zap', k: 'lightning fast electric' },
      { e: '🔥', n: 'fire', k: 'hot flame lit' },
      { e: '💧', n: 'droplet', k: 'water' },
      { e: '☀️', n: 'sun', k: 'sunny day' },
      { e: '🌈', n: 'rainbow', k: 'lgbt colorful' },
      { e: '☁️', n: 'cloud', k: 'weather' },
      { e: '⛈️', n: 'storm', k: 'thunder rain' },
      { e: '🌙', n: 'moon', k: 'night' },
      { e: '🌍', n: 'earth', k: 'globe world' },
    ],
  },
  {
    id: 'food',
    label: 'Food',
    icon: '🍔',
    items: [
      { e: '🍎', n: 'apple', k: 'fruit red' },
      { e: '🍊', n: 'orange', k: 'fruit citrus' },
      { e: '🍋', n: 'lemon', k: 'fruit citrus' },
      { e: '🍌', n: 'banana', k: 'fruit yellow' },
      { e: '🍉', n: 'watermelon', k: 'fruit' },
      { e: '🍇', n: 'grapes', k: 'fruit' },
      { e: '🍓', n: 'strawberry', k: 'fruit' },
      { e: '🥝', n: 'kiwi', k: 'fruit' },
      { e: '🍅', n: 'tomato', k: 'fruit veg' },
      { e: '🥑', n: 'avocado', k: 'fruit' },
      { e: '🥦', n: 'broccoli', k: 'veg' },
      { e: '🥕', n: 'carrot', k: 'veg' },
      { e: '🌽', n: 'corn', k: 'veg' },
      { e: '🌶️', n: 'hot_pepper', k: 'spicy' },
      { e: '🍞', n: 'bread', k: 'toast' },
      { e: '🥐', n: 'croissant', k: 'french' },
      { e: '🥖', n: 'baguette', k: 'french bread' },
      { e: '🥯', n: 'bagel', k: 'bread' },
      { e: '🧀', n: 'cheese', k: 'dairy' },
      { e: '🥚', n: 'egg', k: 'protein' },
      { e: '🍳', n: 'cooking', k: 'egg' },
      { e: '🥞', n: 'pancakes', k: 'breakfast' },
      { e: '🥓', n: 'bacon', k: 'meat' },
      { e: '🍔', n: 'burger', k: 'food' },
      { e: '🍟', n: 'fries', k: 'food' },
      { e: '🍕', n: 'pizza', k: 'italian' },
      { e: '🌭', n: 'hotdog', k: 'sausage' },
      { e: '🌮', n: 'taco', k: 'mexican' },
      { e: '🌯', n: 'burrito', k: 'mexican' },
      { e: '🍜', n: 'ramen', k: 'noodles' },
      { e: '🍣', n: 'sushi', k: 'japanese fish' },
      { e: '🍰', n: 'cake', k: 'dessert' },
      { e: '🎂', n: 'birthday_cake', k: 'birthday' },
      { e: '🍩', n: 'donut', k: 'dessert' },
      { e: '🍪', n: 'cookie', k: 'dessert' },
      { e: '🍫', n: 'chocolate', k: 'dessert' },
      { e: '🍬', n: 'candy', k: 'sweet' },
      { e: '🍭', n: 'lollipop', k: 'candy' },
      { e: '🍺', n: 'beer', k: 'alcohol' },
      { e: '🍷', n: 'wine', k: 'alcohol' },
      { e: '🍸', n: 'cocktail', k: 'drink' },
      { e: '🍹', n: 'tropical_drink', k: 'cocktail' },
      { e: '☕', n: 'coffee', k: 'caffeine morning' },
      { e: '🍵', n: 'tea', k: 'drink' },
    ],
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: '⚽',
    items: [
      { e: '⚽', n: 'soccer', k: 'football sport' },
      { e: '🏀', n: 'basketball', k: 'sport' },
      { e: '🏈', n: 'football', k: 'american sport' },
      { e: '⚾', n: 'baseball', k: 'sport' },
      { e: '🎾', n: 'tennis', k: 'sport' },
      { e: '🏐', n: 'volleyball', k: 'sport' },
      { e: '🏓', n: 'ping_pong', k: 'table tennis' },
      { e: '🏸', n: 'badminton', k: 'sport' },
      { e: '🥊', n: 'boxing', k: 'sport' },
      { e: '🎮', n: 'video_game', k: 'gaming controller' },
      { e: '🕹️', n: 'joystick', k: 'gaming retro' },
      { e: '🎲', n: 'dice', k: 'game random' },
      { e: '🎯', n: 'target', k: 'goal bullseye' },
      { e: '🎨', n: 'art', k: 'paint palette' },
      { e: '🎭', n: 'theater', k: 'drama masks' },
      { e: '🎬', n: 'clapper', k: 'movie film' },
      { e: '🎤', n: 'microphone', k: 'sing karaoke' },
      { e: '🎧', n: 'headphones', k: 'music audio' },
      { e: '🎵', n: 'note', k: 'music' },
      { e: '🎼', n: 'music_score', k: 'notes' },
      { e: '🎸', n: 'guitar', k: 'music' },
      { e: '🥁', n: 'drum', k: 'music' },
      { e: '🎹', n: 'piano', k: 'music keyboard' },
      { e: '🎺', n: 'trumpet', k: 'music brass' },
      { e: '🎉', n: 'tada', k: 'party celebration' },
      { e: '🎊', n: 'confetti', k: 'party celebration' },
      { e: '🎁', n: 'gift', k: 'present birthday' },
      { e: '🎈', n: 'balloon', k: 'party birthday' },
      { e: '🏆', n: 'trophy', k: 'winner award' },
      { e: '🥇', n: 'first_place', k: 'gold medal' },
      { e: '🥈', n: 'second_place', k: 'silver medal' },
      { e: '🥉', n: 'third_place', k: 'bronze medal' },
      { e: '🏅', n: 'medal', k: 'award sport' },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '💻',
    items: [
      { e: '💻', n: 'computer', k: 'laptop tech' },
      { e: '🖥️', n: 'desktop', k: 'computer monitor' },
      { e: '⌨️', n: 'keyboard', k: 'typing tech' },
      { e: '🖱️', n: 'mouse_computer', k: 'pointer' },
      { e: '🖨️', n: 'printer', k: 'office' },
      { e: '📱', n: 'phone', k: 'mobile cell' },
      { e: '📞', n: 'telephone', k: 'call phone' },
      { e: '☎️', n: 'phone_classic', k: 'landline' },
      { e: '📟', n: 'pager', k: 'beeper' },
      { e: '📠', n: 'fax', k: 'office' },
      { e: '📺', n: 'tv', k: 'television' },
      { e: '📷', n: 'camera', k: 'photo' },
      { e: '📸', n: 'camera_flash', k: 'photo shot' },
      { e: '📹', n: 'video_camera', k: 'record' },
      { e: '🎥', n: 'movie_camera', k: 'film' },
      { e: '💾', n: 'floppy', k: 'save disk' },
      { e: '💿', n: 'cd', k: 'disc dvd' },
      { e: '📀', n: 'dvd', k: 'disc' },
      { e: '💡', n: 'bulb', k: 'idea light' },
      { e: '🔦', n: 'flashlight', k: 'torch' },
      { e: '🕯️', n: 'candle', k: 'light' },
      { e: '🔋', n: 'battery', k: 'power' },
      { e: '🔌', n: 'plug', k: 'electric power' },
      { e: '🖲️', n: 'trackball', k: 'input' },
      { e: '💽', n: 'minidisc', k: 'save' },
      { e: '📼', n: 'vhs', k: 'tape' },
      { e: '📡', n: 'satellite', k: 'antenna signal' },
      { e: '🔍', n: 'search', k: 'magnify find' },
      { e: '🔎', n: 'search_right', k: 'magnify find' },
      { e: '🔓', n: 'unlock', k: 'open' },
      { e: '🔒', n: 'lock', k: 'secure' },
      { e: '🔏', n: 'lock_pen', k: 'security' },
      { e: '🔐', n: 'closed_lock_key', k: 'secure' },
      { e: '🔑', n: 'key', k: 'unlock' },
      { e: '🗝️', n: 'old_key', k: 'unlock antique' },
      { e: '🔨', n: 'hammer', k: 'tool build' },
      { e: '⛏️', n: 'pick', k: 'mining tool' },
      { e: '⚒️', n: 'hammer_pick', k: 'tools' },
      { e: '🛠️', n: 'tools', k: 'wrench hammer build' },
      { e: '🗡️', n: 'dagger', k: 'knife weapon' },
      { e: '⚔️', n: 'crossed_swords', k: 'fight battle' },
      { e: '🔧', n: 'wrench', k: 'tool fix' },
      { e: '🔩', n: 'nut_bolt', k: 'tool' },
      { e: '⚙️', n: 'gear', k: 'settings config cog' },
      { e: '🧰', n: 'toolbox', k: 'tools' },
      { e: '🧲', n: 'magnet', k: 'attract' },
      { e: '💰', n: 'money_bag', k: 'cash rich' },
      { e: '💵', n: 'dollar', k: 'money cash' },
      { e: '💳', n: 'credit_card', k: 'payment' },
      { e: '📚', n: 'books', k: 'library read' },
      { e: '📖', n: 'book_open', k: 'read study' },
      { e: '📝', n: 'memo', k: 'note write' },
      { e: '✏️', n: 'pencil', k: 'write edit' },
      { e: '🖊️', n: 'pen', k: 'write' },
      { e: '🖋️', n: 'fountain_pen', k: 'write' },
      { e: '📄', n: 'page', k: 'document paper' },
      { e: '📃', n: 'page_curl', k: 'document paper' },
      { e: '📑', n: 'bookmark_tabs', k: 'index bookmark' },
      { e: '🔖', n: 'bookmark', k: 'save read' },
      { e: '📊', n: 'chart_bar', k: 'graph data analytics' },
      { e: '📈', n: 'chart_up', k: 'trend growth' },
      { e: '📉', n: 'chart_down', k: 'trend decline' },
      { e: '📋', n: 'clipboard', k: 'copy list' },
      { e: '📌', n: 'pin', k: 'save location' },
      { e: '📍', n: 'round_pin', k: 'location map' },
      { e: '🚀', n: 'rocket', k: 'launch fast space' },
      { e: '🛸', n: 'ufo', k: 'alien saucer' },
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '❤️',
    items: [
      { e: '❤️', n: 'heart', k: 'love red' },
      { e: '🧡', n: 'orange_heart', k: 'love' },
      { e: '💛', n: 'yellow_heart', k: 'love' },
      { e: '💚', n: 'green_heart', k: 'love' },
      { e: '💙', n: 'blue_heart', k: 'love' },
      { e: '💜', n: 'purple_heart', k: 'love' },
      { e: '🖤', n: 'black_heart', k: 'love' },
      { e: '🤍', n: 'white_heart', k: 'love' },
      { e: '💔', n: 'broken_heart', k: 'sad' },
      { e: '💕', n: 'two_hearts', k: 'love' },
      { e: '💖', n: 'sparkling_heart', k: 'love' },
      { e: '💘', n: 'cupid', k: 'arrow love' },
      { e: '💝', n: 'gift_heart', k: 'valentine' },
      { e: '☮️', n: 'peace', k: 'symbol' },
      { e: '✝️', n: 'cross', k: 'christian' },
      { e: '☪️', n: 'crescent', k: 'islam moon star' },
      { e: '🕉️', n: 'om', k: 'hindu' },
      { e: '☸️', n: 'dharma', k: 'buddhist wheel' },
      { e: '✡️', n: 'star_of_david', k: 'jewish' },
      { e: '♻️', n: 'recycle', k: 'green environment' },
      { e: '✅', n: 'check_mark_button', k: 'done yes ok success' },
      { e: '❎', n: 'cross_mark_button', k: 'no cancel' },
      { e: '❌', n: 'x', k: 'wrong no cancel error' },
      { e: '➕', n: 'plus', k: 'add' },
      { e: '➖', n: 'minus', k: 'subtract' },
      { e: '➗', n: 'divide', k: 'math' },
      { e: '✖️', n: 'multiply', k: 'math x' },
      { e: '♾️', n: 'infinity', k: 'endless forever' },
      { e: '❓', n: 'question', k: 'ask help' },
      { e: '❗', n: 'exclamation', k: 'alert' },
      { e: '❕', n: 'grey_exclamation', k: 'alert' },
      { e: '💯', n: '100', k: 'perfect hundred' },
      { e: '⚠️', n: 'warning', k: 'caution danger alert' },
      { e: '🚫', n: 'no_entry', k: 'forbid stop' },
      { e: '⛔', n: 'no_entry_sign', k: 'stop' },
      { e: 'ℹ️', n: 'info', k: 'information' },
      { e: '🔔', n: 'bell', k: 'notification alert' },
      { e: '🔕', n: 'mute_bell', k: 'silent' },
      { e: '💬', n: 'speech_bubble', k: 'chat message' },
      { e: '💭', n: 'thought_bubble', k: 'think' },
      { e: '🗯️', n: 'anger_bubble', k: 'shout' },
      { e: '💤', n: 'zzz', k: 'sleep tired' },
      { e: '⏳', n: 'hourglass', k: 'wait loading' },
      { e: '⌛', n: 'hourglass_done', k: 'time' },
      { e: '⏰', n: 'alarm', k: 'clock time' },
      { e: '⏱️', n: 'stopwatch', k: 'time' },
      { e: '⏲️', n: 'timer', k: 'countdown' },
      { e: '🕐', n: 'clock', k: 'time hour' },
      { e: '📅', n: 'calendar', k: 'date schedule' },
      { e: '📆', n: 'tear_calendar', k: 'date' },
      { e: '🔗', n: 'link', k: 'chain url' },
      { e: '📎', n: 'paperclip', k: 'attach' },
      { e: '🖇️', n: 'paperclips', k: 'attach' },
      { e: '📧', n: 'email', k: 'mail message' },
      { e: '📨', n: 'incoming_mail', k: 'letter' },
      { e: '📩', n: 'envelope_arrow', k: 'send mail' },
      { e: '📤', n: 'outbox', k: 'send' },
      { e: '📥', n: 'inbox', k: 'receive mail' },
      { e: '➡️', n: 'arrow_right', k: 'right forward' },
      { e: '⬅️', n: 'arrow_left', k: 'left back' },
      { e: '⬆️', n: 'arrow_up', k: 'up' },
      { e: '⬇️', n: 'arrow_down', k: 'down' },
      { e: '↗️', n: 'arrow_upper_right', k: 'diagonal' },
      { e: '↘️', n: 'arrow_lower_right', k: 'diagonal' },
      { e: '↙️', n: 'arrow_lower_left', k: 'diagonal' },
      { e: '↖️', n: 'arrow_upper_left', k: 'diagonal' },
      { e: '🔁', n: 'repeat', k: 'loop again' },
      { e: '🔄', n: 'refresh', k: 'reload' },
      { e: '🔃', n: 'clockwise', k: 'reload' },
      { e: '▶️', n: 'play', k: 'start forward' },
      { e: '⏸️', n: 'pause', k: 'stop' },
      { e: '⏹️', n: 'stop', k: 'end' },
      { e: '⏺️', n: 'record', k: 'circle' },
    ],
  },
]

/* ── Build search index & shortcode map on first access ────────── */
let _flatIndex: EmojiEntry[] | null = null
let _shortcodeMap: Record<string, string> | null = null

export const getAllEmojis = (): EmojiEntry[] => {
  if (_flatIndex) return _flatIndex
  _flatIndex = EMOJI_CATEGORIES.flatMap((c) => c.items)
  return _flatIndex
}

/** Returns the emoji character for a given shortcode name, or undefined. */
export const shortcodeToEmoji = (name: string): string | undefined => {
  if (!_shortcodeMap) {
    _shortcodeMap = {}
    for (const c of EMOJI_CATEGORIES) {
      for (const e of c.items) _shortcodeMap[e.n] = e.e
    }
    // Common aliases (GFM / Slack style)
    _shortcodeMap.tada = _shortcodeMap.tada || '🎉'
    _shortcodeMap.eyes = _shortcodeMap.eyes || '👀'
  }
  return _shortcodeMap[name.toLowerCase()]
}

/** Case-insensitive substring search across name + keywords. */
export const searchEmojis = (query: string, limit = 60): EmojiEntry[] => {
  const q = query.trim().toLowerCase()
  const all = getAllEmojis()
  if (!q) return all.slice(0, limit)
  const scored: { entry: EmojiEntry; score: number }[] = []
  for (const entry of all) {
    const n = entry.n.toLowerCase()
    const k = (entry.k || '').toLowerCase()
    let score = 0
    if (n === q) score = 100
    else if (n.startsWith(q)) score = 80
    else if (n.includes(q)) score = 60
    else if (k.split(' ').some((tok) => tok === q)) score = 55
    else if (k.startsWith(q)) score = 40
    else if (k.includes(q)) score = 25
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.entry)
}

/* ── Recent emojis (persisted in localStorage) ─────────────────── */
const RECENT_KEY = 'pm.emoji.recent.v1'
const RECENT_MAX = 24

export const loadRecentEmojis = (): EmojiEntry[] => {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as string[]
    const all = getAllEmojis()
    const map = new Map(all.map((e) => [e.e, e]))
    return arr.map((c) => map.get(c)).filter(Boolean) as EmojiEntry[]
  } catch {
    return []
  }
}

export const pushRecentEmoji = (entry: EmojiEntry): void => {
  try {
    const existing = loadRecentEmojis()
    const next = [entry, ...existing.filter((e) => e.e !== entry.e)].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.map((e) => e.e)))
  } catch {}
}
