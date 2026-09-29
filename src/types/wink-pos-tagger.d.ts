declare module "wink-pos-tagger" {
  type TaggedWord = {
    value: string;
    tag: string;
    pos: string;
  };

  type Tagger = {
    tagSentence: (sentence: string) => TaggedWord[];
  };

  export default function winkPosTagger(): Tagger;
}
