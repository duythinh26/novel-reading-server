import mongoose, { Schema } from "mongoose";

let profile_imgs_name_list = ["Garfield", "Tinkerbell", "Annie", "Loki", "Cleo", "Angel", "Bob", "Mia", "Coco", "Gracie", "Bear", "Bella", "Abby", "Harley", "Cali", "Leo", "Luna", "Jack", "Felix", "Kiki"];
let profile_imgs_collections_list = ["notionists-neutral", "adventurer-neutral", "fun-emoji"];

const userSchema = mongoose.Schema({

    personal_info: {
        username: {
            type: String,
            minlength: [3, 'Username must be at least 3 letters'],
            unique: true,
            require: true,
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            unique: true,
        },
        password: String,
        bio: {
            type: String,
            maxlength: [200, 'Bio should be less than 200'],
            default: "",
        },
        profile_img: {
            type: String,
            default: () => {
                return `https://api.dicebear.com/6.x/${profile_imgs_collections_list[Math.floor(Math.random() * profile_imgs_collections_list.length)]}/svg?seed=${profile_imgs_name_list[Math.floor(Math.random() * profile_imgs_name_list.length)]}`
            } 
        },
    },
    account_info:{
        total_posts: {
            type: Number,
            default: 0
        },
        total_reads: {
            type: Number,
            default: 0
        },
        total_followings: {
            type: Number, 
            default: 0
        },
        total_comments: {
            type: Number,
            default: 0
        },
        coin: {
            type: Number,
            default: 0
        },
        favorite: [

        ],
        ownedEpisode: {
            type: [ Schema.Types.ObjectId ],
            ref: 'comments'
        },
    },
    google_auth: {
        type: Boolean,
        default: false
    },
    novels: {
        type: [ Schema.Types.ObjectId ],
        ref: 'novels',
        default: [],
    }

}, 
{ 
    timestamps: {
        createdAt: 'joinedAt'
    } 

})

export default mongoose.model("users", userSchema);