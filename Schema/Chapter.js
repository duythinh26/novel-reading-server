 import mongoose, { Schema } from "mongoose";

const chapterSchema = mongoose.Schema({

    chapter_id: {
        type: String,
        required: true,
        unique: true,
    },
    chapter_title: {
        type: String,
        required: true,
    },
    chapter_status: {
        type: String,
        enum: [
            "Đang tiến hành", 
            "Tạm ngưng", 
            "Đã hoàn thành"
        ],
        default: "Đang tiến hành",
        required: true,
    },
    chapter_banner: {
        type: String,
    },
    content: {
        type: String,
        required: true
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
        type: [Schema.Types.ObjectId],
        ref: 'comments'
    },
    belonged_to: {
        type: Schema.Types.ObjectId,
        require: true,
        ref: 'episodes'
    },
}, 
{ 
    timestamps: {
        createdAt: 'publishedAt'
    } 
})

export default mongoose.model("chapters", chapterSchema);