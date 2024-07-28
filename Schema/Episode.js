import mongoose, { Schema } from "mongoose";

const episodeSchema = mongoose.Schema({

    episode_id: {
        type: String,
        required: true,
        unique: true,
    },
    episode_title: {
        type: String,
        required: true,
    },
    episode_banner: {
        type: String,
    },
    description: {
        type: String,
    },
    publisher: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'users'
    },
    activity: {
        total_likes: {
            type: Number,
            default: 0
        },
        total_comments: {
            type: Number,
            default: 0
        },
        total_reads: {
            type: Number,
            default: 0
        },
        total_parent_comments: {
            type: Number,
            default: 0
        },
    },
    comments: {
        type: [ Schema.Types.ObjectId ],
        ref: 'comments'
    },
    price: {
        type: Number,
        required: true
    },
    chapter: {
        type: [ Schema.Types.ObjectId ],
        // required: true,
        ref: 'chapters',
        default: [],
    },
    belonged_to: {
        type: Schema.Types.ObjectId,
        require: true,
        ref: 'novels'
    },
}, 
{ 
    timestamps: {
        createdAt: 'publishedAt'
    } 
})

export default mongoose.model("episodes", episodeSchema);